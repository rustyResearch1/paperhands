import { db } from './db'

/**
 * Market alerts computed straight from the ledger — no opinions, just the
 * three things that change a position's truth: price collapsing, liquidity
 * leaving, and volume arriving.
 */
export type Alert =
  | { kind: 'dump'; pool: string; symbol: string; quoteSymbol: string; changePct: number; depth: number; vol24: number; ts: number }
  | { kind: 'pull'; pool: string; symbol: string; quoteSymbol: string; pulledPct: number; block: number; txHash: string; ts: number }
  | { kind: 'surge'; pool: string; symbol: string; quoteSymbol: string; ratio: number; vol30: number; ts: number }

const Q96 = 79228162514264337593543950336

// ~14 blocks/s on Robinhood Chain: two hours of blocks.
const PULL_WINDOW_BLOCKS = 100_000

export function marketAlerts(limit = 30): Alert[] {
  const now = Math.floor(Date.now() / 1000)
  const out: Alert[] = []

  const dumps = db
    .prepare(
      `SELECT p.address AS pool, tb.symbol AS sym, COALESCE(p.quote_symbol,'WETH') AS q,
         (SELECT close FROM candles c WHERE c.pool=p.address ORDER BY minute_ts DESC LIMIT 1) AS px,
         (SELECT minute_ts FROM candles c WHERE c.pool=p.address ORDER BY minute_ts DESC LIMIT 1) AS ts,
         (SELECT close FROM candles c WHERE c.pool=p.address AND c.minute_ts <= @t180 ORDER BY minute_ts DESC LIMIT 1) AS px3h,
         (SELECT COALESCE(SUM(vol_quote),0) FROM candles c WHERE c.pool=p.address AND c.minute_ts > @t24) AS v24,
         CAST(p.last_liquidity AS REAL) AS liq, CAST(p.last_sqrt_price AS REAL) AS sqrtp, p.base_is_token0 AS b0, tq.decimals AS qd
       FROM pools p JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0=1 THEN p.token0 ELSE p.token1 END
       JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0=1 THEN p.token1 ELSE p.token0 END
       WHERE p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND tb.symbol NOT IN ('USDG','USDe','WETH')
         AND p.swap_count > 20
       ORDER BY p.last_swap_block DESC LIMIT 400`,
    )
    .all({ t180: now - 10_800, t24: now - 86_400 }) as {
    pool: string
    sym: string
    q: string
    px: number | null
    ts: number | null
    px3h: number | null
    v24: number
    liq: number
    sqrtp: number
    b0: number
    qd: number
  }[]
  for (const r of dumps) {
    if (!r.px || !r.px3h || r.px3h <= 0 || !r.ts || r.ts < now - 10_800) continue
    const ratio = r.px / r.px3h
    const minVol = r.q === 'WETH' || r.q === 'ETH' ? 1 : 3000
    if (ratio < 0.5 && r.v24 > minVol) {
      // Quote-side reserve of the active tick range: L·√P when quote is token1, L/√P when token0.
      const sqrt = r.sqrtp / Q96
      const depthRaw = r.sqrtp > 0 ? (r.b0 === 1 ? r.liq * sqrt : r.liq / sqrt) : 0
      const depth = depthRaw / 10 ** r.qd
      out.push({ kind: 'dump', pool: r.pool, symbol: r.sym, quoteSymbol: r.q, changePct: (ratio - 1) * 100, depth, vol24: r.v24, ts: r.ts })
    }
  }

  // Chain head estimate from the newest recorded swap: liquidity events can
  // run ahead of the swap cursor, so the cursor itself is not a clock.
  const ref = db.prepare(`SELECT MAX(block) AS b, MAX(ts) AS t FROM swaps`).get() as { b: number | null; t: number | null }
  const cursor = ref.b && ref.t ? ref.b + Math.round(Math.max(0, now - ref.t) * 14) : 0
  if (cursor > 0) {
    const pulls = db
      .prepare(
        `SELECT l.pool, l.tx_hash AS txHash, l.block, CAST(l.amount AS REAL) AS amt, CAST(p.last_liquidity AS REAL) AS liq,
                tb.symbol AS sym, COALESCE(p.quote_symbol,'WETH') AS q
         FROM liq_events l JOIN pools p ON p.address = l.pool
         JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0=1 THEN p.token0 ELSE p.token1 END
         WHERE l.kind = -1 AND l.block > @from AND p.swap_count > 30 AND p.factory_verified = 1 AND p.base_is_token0 IS NOT NULL
           AND tb.symbol NOT IN ('USDG','USDe','WETH','ETH')
         ORDER BY l.block DESC LIMIT 2000`,
      )
      .all({ from: cursor - PULL_WINDOW_BLOCKS }) as { pool: string; txHash: string; block: number; amt: number; liq: number; sym: string; q: string }[]
    const seen = new Set<string>()
    for (const r of pulls) {
      if (seen.has(r.pool)) continue
      const pct = (r.amt / Math.max(r.amt + r.liq, 1)) * 100
      if (pct >= 50) {
        seen.add(r.pool)
        // Block → wall clock at ~14 blocks/s; close enough for "12m ago".
        const ts = now - Math.round(Math.max(0, cursor - r.block) / 14)
        out.push({ kind: 'pull', pool: r.pool, symbol: r.sym, quoteSymbol: r.q, pulledPct: pct, block: r.block, txHash: r.txHash, ts })
      }
    }
  }

  const surges = db
    .prepare(
      `SELECT p.address AS pool, tb.symbol AS sym, COALESCE(p.quote_symbol,'WETH') AS q,
         (SELECT COALESCE(SUM(vol_quote),0) FROM candles c WHERE c.pool=p.address AND c.minute_ts > @t30) AS v30,
         (SELECT COALESCE(SUM(vol_quote),0) FROM candles c WHERE c.pool=p.address AND c.minute_ts > @t60 AND c.minute_ts <= @t30) AS vPrev
       FROM pools p JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0=1 THEN p.token0 ELSE p.token1 END
       WHERE p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND p.swap_count > 20 AND tb.symbol NOT IN ('USDG','USDe','WETH')
       ORDER BY p.last_swap_block DESC LIMIT 400`,
    )
    .all({ t30: now - 1_800, t60: now - 3_600 }) as { pool: string; sym: string; q: string; v30: number; vPrev: number }[]
  for (const r of surges) {
    const minVol = r.q === 'WETH' || r.q === 'ETH' ? 0.5 : 1500
    if (r.v30 < minVol) continue
    const ratio = r.vPrev > 0 ? r.v30 / r.vPrev : Infinity
    if (ratio >= 4) out.push({ kind: 'surge', pool: r.pool, symbol: r.sym, quoteSymbol: r.q, ratio: Number.isFinite(ratio) ? ratio : 99, vol30: r.v30, ts: now })
  }

  // Newest first within each kind. Losses (pulls, dumps) get up to 60% of
  // the slots so a busy launch day can't bury a drain; surges fill the rest.
  const byTime = (a: Alert, b: Alert) => b.ts - a.ts
  const bad = out.filter((a) => a.kind !== 'surge').sort(byTime)
  const good = out.filter((a) => a.kind === 'surge').sort(byTime)
  const badN = Math.min(bad.length, Math.max(1, Math.ceil(limit * 0.6)))
  const result = [...bad.slice(0, badN), ...good.slice(0, limit - badN)]
  if (result.length < limit) result.push(...bad.slice(badN, badN + (limit - result.length)))
  return result
}
