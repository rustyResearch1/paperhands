import { readV3Pool, type ChainClient } from '@paperhands/chain'
import { roundTripV3 } from '@paperhands/engine'
import type Database from 'better-sqlite3'
import type { Address } from 'viem'
import { getMeta } from './db.js'
import { lpBacktest, walletReplay } from './lab.js'

/**
 * The content engine: turns today's ledger into ready-to-paste post drafts.
 * Every number is computed from our own indexed data and engine — the whole
 * point is that nobody else can generate these screenshots.
 */

const fmtUsd = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 10_000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(2)}`
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

function ethUsd(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT (SELECT close FROM candles c WHERE c.pool = p.address ORDER BY minute_ts DESC LIMIT 1) AS close
       FROM pools p JOIN tokens t ON t.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE t.symbol = 'USDG' AND p.factory_verified = 1 AND p.base_is_token0 IS NOT NULL
       ORDER BY p.swap_count DESC LIMIT 1`,
    )
    .get() as { close: number | null }
  return row?.close && row.close > 0 ? 1 / row.close : 2400
}

export async function generateContentPack(client: ChainClient, db: Database.Database): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const rate = ethUsd(db)
  const cursor = Number(getMeta(db, 'watch_cursor') ?? 0)
  const liqFrom = Number(getMeta(db, 'liq_from') ?? 0)
  const out: string[] = [
    `# PaperHands content pack — ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `ETH/USD used: $${Math.round(rate)} (from the chain's USDG pool). Paste-ready drafts below —`,
    `attach a screenshot of the referenced page to each. Post 1–2/day max, reply to everything.`,
    ``,
  ]

  // ---- 1. traction movers -------------------------------------------------
  try {
    const movers = db
      .prepare(
        `SELECT tb.symbol AS sym, p.address AS pool,
           (SELECT COALESCE(SUM(vol_quote),0) FROM candles c WHERE c.pool=p.address AND c.minute_ts > @t30) AS v30,
           (SELECT COALESCE(SUM(vol_quote),0) FROM candles c WHERE c.pool=p.address AND c.minute_ts > @t60 AND c.minute_ts <= @t30) AS v30p,
           (SELECT close FROM candles c WHERE c.pool=p.address ORDER BY minute_ts DESC LIMIT 1) AS px,
           (SELECT close FROM candles c WHERE c.pool=p.address AND c.minute_ts <= @t180 ORDER BY minute_ts DESC LIMIT 1) AS px3h
         FROM pools p JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0=1 THEN p.token0 ELSE p.token1 END
         WHERE p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND tb.symbol != 'USDG' AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
         ORDER BY v30 DESC LIMIT 60`,
      )
      .all({ t30: now - 1800, t60: now - 3600, t180: now - 10800 }) as {
      sym: string
      pool: string
      v30: number
      v30p: number
      px: number | null
      px3h: number | null
    }[]
    const hot = movers
      .filter((m) => m.v30 > 1 && m.v30p > 0.05)
      .map((m) => ({ ...m, x: m.v30 / m.v30p }))
      .sort((a, b) => b.x - a.x)
      .slice(0, 3)
    if (hot.length) {
      out.push(`## 1 · Traction watch (screenshot: /?sort=traction)`, ``)
      const lines = hot.map(
        (m) =>
          `$${m.sym}: ${m.x.toFixed(1)}x volume acceleration, ${fmtUsd(m.v30 * rate)} in 30m` +
          (m.px && m.px3h ? ` (${pct(((m.px - m.px3h) / m.px3h) * 100)} on 3h)` : ''),
      )
      out.push(
        `> volume is the one signal a rug can't fake for free. what's accelerating on robinhood chain right now:`,
        `>`,
        ...lines.map((l) => `> ${l}`),
        `>`,
        `> live board (free, no wallet): [link]`,
        ``,
      )
    }
  } catch (e) {
    out.push(`_(traction section failed: ${(e as Error).message})_`, ``)
  }

  // ---- 2. rug receipts ----------------------------------------------------
  try {
    const rugs = db
      .prepare(
        `SELECT tb.symbol AS sym,
           (SELECT close FROM candles c WHERE c.pool=p.address ORDER BY minute_ts DESC LIMIT 1) AS px,
           (SELECT close FROM candles c WHERE c.pool=p.address AND c.minute_ts <= @t180 ORDER BY minute_ts DESC LIMIT 1) AS px3h,
           (SELECT COALESCE(SUM(vol_quote),0) FROM candles c WHERE c.pool=p.address AND c.minute_ts > @t24) AS v24,
           CAST(p.last_liquidity AS REAL) * CAST(p.last_sqrt_price AS REAL) / 79228162514264337593543950336.0 / 1e18 AS depthEth
         FROM pools p JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0=1 THEN p.token0 ELSE p.token1 END
         WHERE p.base_is_token0 = 1 AND p.factory_verified = 1 AND tb.symbol NOT IN ('USDG','USDe','WETH') AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
         ORDER BY p.swap_count DESC LIMIT 200`,
      )
      .all({ t180: now - 10800, t24: now - 86400 }) as {
      sym: string
      px: number | null
      px3h: number | null
      v24: number
      depthEth: number
    }[]
    // Only pools that had real money in them — a dead micro pool drifting to
    // zero is noise, not a receipt.
    const dead = rugs
      .filter((r) => r.px && r.px3h && r.px3h > 0 && r.px / r.px3h < 0.4 && r.v24 > 2)
      .sort((a, b) => a.px! / a.px3h! - b.px! / b.px3h!)
      .slice(0, 2)
    if (dead.length) {
      out.push(`## 2 · Rug receipts (screenshot: the token page chart)`, ``)
      for (const r of dead) {
        out.push(
          `> $${r.sym} is down ${pct(((r.px! - r.px3h!) / r.px3h!) * 100)} in 3 hours with ~${r.depthEth.toFixed(1)} ETH of exit depth left.`,
          `> holders' screens still show a number. the pool disagrees. this is why we show "what the pool would pay."`,
          ``,
        )
      }
    }
  } catch (e) {
    out.push(`_(rug section failed: ${(e as Error).message})_`, ``)
  }

  // ---- 3. the replay files (the headline format) --------------------------
  try {
    const whale = db
      .prepare(
        `SELECT trader, -SUM(eth) AS flow, COUNT(*) AS n FROM
           (SELECT s.trader, CAST(CASE WHEN p.base_is_token0=1 THEN s.amount1 ELSE s.amount0 END AS REAL)/1e18 AS eth
            FROM swaps s JOIN pools p ON p.address = s.pool
            WHERE s.trader IS NOT NULL AND s.ts > @t24 AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH'))
         GROUP BY trader HAVING n >= 10 ORDER BY flow DESC LIMIT 1`,
      )
      .get({ t24: now - 86400 }) as { trader: string; flow: number; n: number } | undefined
    if (whale && cursor && liqFrom) {
      const first = db
        .prepare('SELECT MIN(block) AS b FROM swaps WHERE trader = ? AND ts > ?')
        .get(whale.trader, now - 86400) as { b: number | null }
      if (first.b) {
        const r = await walletReplay(client, db, whale.trader, 25n * 10n ** 16n, Math.max(first.b - 1, liqFrom), cursor)
        const short = `${whale.trader.slice(0, 6)}…${whale.trader.slice(-4)}`
        out.push(`## 3 · The Replay Files (screenshot: /w/${whale.trader} replay panel)`, ``)
        out.push(
          `> wallet ${short} pulled +${whale.flow.toFixed(2)} ETH out of robinhood chain pools in 24h across ${whale.n} swaps. looks copyable, right?`,
          `>`,
          `> we replayed copying it — every entry, every exit, at 0.25 ETH a trade, through recorded liquidity:`,
          `> **${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(3)} ETH on ${r.totalInvested.toFixed(2)} deployed (${pct((r.totalPnl / Math.max(r.totalInvested, 0.01)) * 100)})**`,
          `>`,
          `> ${r.totalPnl < 0 ? 'whales profit. copiers are exit liquidity.' : 'this one actually would have paid. most do not.'} run any wallet before you tail it: [link]`,
          ``,
        )
      }
    }
  } catch (e) {
    out.push(`_(replay section failed: ${(e as Error).message})_`, ``)
  }

  // ---- 4. LP lab result ---------------------------------------------------
  try {
    const pool = db
      .prepare(
        `SELECT p.address AS pool, tb.symbol AS sym,
           (SELECT COALESCE(SUM(vol_quote),0) FROM candles c WHERE c.pool=p.address AND c.minute_ts > @t24) AS v24
         FROM pools p JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0=1 THEN p.token0 ELSE p.token1 END
         WHERE p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND tb.symbol NOT IN ('USDG') AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
         ORDER BY v24 DESC LIMIT 1`,
      )
      .get({ t24: now - 86400 }) as { pool: string; sym: string; v24: number } | undefined
    if (pool && cursor && liqFrom) {
      const firstSwap = db
        .prepare('SELECT MIN(block) AS b FROM swaps WHERE pool = ? AND ts > ?')
        .get(pool.pool, now - 86400) as { b: number | null }
      if (firstSwap.b) {
        const r = await lpBacktest(client, db, {
          pool: pool.pool,
          rangePct: 30,
          quoteWei: 10n ** 18n,
          fromBlock: Math.max(firstSwap.b - 1, liqFrom),
          toBlock: cursor,
        })
        const verdict = r.netVsHodl >= 0 ? 'fees beat the bleed' : 'the fees did NOT cover what the range lost'
        out.push(`## 4 · LP Lab (screenshot: /t/${pool.pool} lp lab panel)`, ``)
        out.push(
          `> would LPing $${pool.sym} (±30%) have paid over the last ${r.hours.toFixed(0)}h? we replayed all ${r.swapsReplayed.toLocaleString()} swaps through the position:`,
          `>`,
          `> fees earned: ${r.feesEarned.toFixed(4)} ETH (${fmtUsd(r.feesEarned * rate)}) · IL: ${r.impermanentLoss.toFixed(4)} ETH · net vs holding: ${r.netVsHodl >= 0 ? '+' : ''}${r.netVsHodl.toFixed(4)} ETH · ${r.aprPct.toFixed(0)}% APR run-rate`,
          `>`,
          `> ${verdict}. backtest any pool/range yourself: [link]`,
          ``,
        )
      }
    }
  } catch (e) {
    out.push(`_(lp section failed: ${(e as Error).message})_`, ``)
  }

  // ---- 5. mark vs reality -------------------------------------------------
  try {
    const cands = db
      .prepare(
        `SELECT p.address AS pool, tb.symbol AS sym, p.base_is_token0 AS b0
         FROM pools p JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0=1 THEN p.token0 ELSE p.token1 END
         WHERE p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND tb.symbol NOT IN ('USDG') AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
         ORDER BY (SELECT COALESCE(SUM(vol_quote),0) FROM candles c WHERE c.pool=p.address AND c.minute_ts > ${now - 21600}) DESC
         LIMIT 4`,
      )
      .all() as { pool: string; sym: string; b0: number }[]
    let worst: { sym: string; infl: number } | null = null
    for (const c of cands) {
      try {
        const snap = await readV3Pool(client, c.pool as Address)
        const rt = roundTripV3(snap.state, 10n ** 18n, c.b0 === 1)
        if (Number.isFinite(rt.markInflation) && (!worst || rt.markInflation > worst.infl)) {
          worst = { sym: c.sym, infl: rt.markInflation }
        }
      } catch {
        // pool unreadable right now; next candidate
      }
    }
    if (worst && worst.infl > 1.02) {
      out.push(`## 5 · Mark vs reality (screenshot: order slip with the highlighted warning)`, ``)
      out.push(
        `> buy 1 ETH of $${worst.sym} right now and your PnL screen will mark the bag at ${worst.infl.toFixed(2)}x what the pool would actually pay you to exit.`,
        `>`,
        `> marked ≠ realizable. the gap is why people diamond-hand to zero. we show both numbers on every position: [link]`,
        ``,
      )
    }
  } catch (e) {
    out.push(`_(mark section failed: ${(e as Error).message})_`, ``)
  }

  out.push(
    `---`,
    `Reply-discipline checklist (do this before posting anything):`,
    `- [ ] 20 substantive replies to ecosystem accounts (Pons, hood.fun, HOOD10, Delta, RH chain devs, CT data accounts)`,
    `- [ ] answer every reply on our own posts from yesterday`,
    `- [ ] one quote-post of someone's win/loss with an honest replay or depth number added`,
  )
  return out.join('\n')
}
