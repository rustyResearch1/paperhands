import { CLOSED_META_KEY, CLOSED_TS_KEY, type TradeClose } from '@paperhands/indexer'
import { db } from './db'
import { storedSnapshot } from './screener'
import { ethUsdRate } from './usd'

/**
 * The live tape: every attributed swap on Robinhood Chain as it lands in the
 * ledger, sized in USD, with the ranked (profitable) wallets as the default
 * "tracked" set. Fresh pools and closed trades sit beside it.
 *
 * Everything is keyed off the newest swap block (the ledger's tip) and the
 * block rate measured from the ledger itself, so "last 5 minutes" means what
 * it says whatever the chain is doing.
 */
export interface TapeFill {
  block: number
  ts: number
  tx: string
  logIndex: number
  pool: string
  token: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  /** Size in the pool's quote units (ETH or USDG). */
  quote: number
  quoteSymbol: string
  usd: number | null
  /** ETH per token on this fill (ETH-quoted pools only). */
  price: number | null
  trader: string | null
  rank: number | null
}

/** Cash legs never count as a "token" on the tape. */
const CASH = `('USDG','USDE','WETH','USDC','USDT','ETH')`

/** Newest block in the ledger (covering-index MAX, instant). */
export function tipBlock(): number {
  return Number((db.prepare(`SELECT MAX(block) AS b FROM swaps`).get() as { b: number | null }).b ?? 0)
}

let rateCache: { at: number; tip: number; rate: number; tipTs: number } | null = null
/** Blocks per second over the last ~20k blocks, and the tip's timestamp; cached a minute. */
export function blockRate(): { tip: number; rate: number; tipTs: number } {
  if (rateCache && Date.now() - rateCache.at < 60_000) return rateCache
  const tip = tipBlock()
  const span = 20_000
  const first = db.prepare(`SELECT ts FROM swaps WHERE block > ? ORDER BY block ASC LIMIT 1`).get(tip - span) as { ts: number } | undefined
  const last = db.prepare(`SELECT ts FROM swaps WHERE block = ? LIMIT 1`).get(tip) as { ts: number } | undefined
  const secs = first && last ? last.ts - first.ts : 0
  const rate = secs > 0 ? Math.min(30, Math.max(1, span / secs)) : 10
  rateCache = { at: Date.now(), tip, rate, tipTs: last?.ts ?? 0 }
  return rateCache
}

const blocksAgo = (sec: number) => {
  const { tip, rate } = blockRate()
  return Math.max(0, Math.floor(tip - sec * rate))
}

let rankedCache: { at: number; set: Map<string, number> } | null = null
/** Ranked wallets → rank, cached for a minute. */
export function rankedWallets(): Map<string, number> {
  if (rankedCache && Date.now() - rankedCache.at < 60_000) return rankedCache.set
  const set = new Map<string, number>()
  try {
    for (const r of db.prepare(`SELECT trader, rank FROM wire_rank`).all() as { trader: string; rank: number }[]) set.set(r.trader, r.rank)
  } catch {
    // table not there yet
  }
  rankedCache = { at: Date.now(), set }
  return set
}

interface FillRow {
  block: number
  ts: number
  tx_hash: string
  log_index: number
  pool: string
  trader: string | null
  amount0: string
  amount1: string
  base_is_token0: number
  q: string
  qd: number
  symbol: string
  decimals: number
  token: string
}

export function latestFills(opts: { sinceBlock?: number; limit?: number; tracked?: boolean; side?: 'buy' | 'sell'; minUsd?: number } = {}): TapeFill[] {
  const limit = Math.min(300, Math.max(1, opts.limit ?? 120))
  const rate = ethUsdRate()
  const ranked = rankedWallets()
  // Without a since-block, look back an hour; the block index keeps it cheap.
  const since = opts.sinceBlock ?? blocksAgo(3600)
  // Side and size are filtered in SQL so LIMIT applies after them — a "sells ≥ $10k" stream
  // must walk back to the last few, not just the newest N rows. The quote leg is amount1 when
  // the base is token0, else amount0; positive = the pool received quote = a buy.
  const quoteLeg = `(CASE WHEN p.base_is_token0 = 1 THEN CAST(s.amount1 AS REAL) ELSE CAST(s.amount0 AS REAL) END)`
  const isEthQuote = `COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')`
  const args: (number | string)[] = [since]
  let where = ''
  if (opts.side) where += ` AND ${quoteLeg} ${opts.side === 'buy' ? '>' : '<'} 0`
  if (opts.minUsd && rate) {
    // Raw quote units: ETH pools are 18 decimals; stable quotes are 6 (USDG/USDC/USDT) or 18 (USDe).
    where += ` AND ABS(${quoteLeg}) >= CASE WHEN ${isEthQuote} THEN ? ELSE ? * (CASE tq.decimals WHEN 18 THEN 1e18 ELSE 1e6 END) END`
    args.push((opts.minUsd / rate) * 1e18, opts.minUsd)
  }
  args.push(limit)
  // Drive the scan from the swaps index (block, or trader+block for the tracked set) and
  // force the join order — the planner otherwise starts from `tokens` and walks millions of rows.
  const sql = (hint: string) =>
    `SELECT s.block, s.ts, s.tx_hash, s.log_index, s.pool, s.trader, s.amount0, s.amount1,
            p.base_is_token0, COALESCE(p.quote_symbol,'WETH') AS q, tq.decimals AS qd,
            tb.symbol AS symbol, tb.decimals AS decimals, tb.address AS token
     FROM swaps s ${hint}
     CROSS JOIN pools p ON p.address = s.pool
     CROSS JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
     CROSS JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0 = 1 THEN p.token1 ELSE p.token0 END
     WHERE s.block > ? AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND upper(tb.symbol) NOT IN ${CASH}
       ${opts.tracked ? 'AND s.trader IN (SELECT trader FROM wire_rank)' : ''}${where}
     ORDER BY s.block DESC, s.log_index DESC LIMIT ?`
  let rows: FillRow[]
  try {
    rows = db.prepare(sql(opts.tracked ? 'INDEXED BY swaps_trader_block' : 'INDEXED BY swaps_block')).all(...args) as FillRow[]
  } catch (err) {
    // The late indexes are built at boot; until they exist, let the planner do its best.
    if (!/no query solution|no such index/i.test((err as Error).message)) throw err
    rows = db.prepare(sql('')).all(...args) as FillRow[]
  }
  const out: TapeFill[] = []
  for (const r of rows) {
    const quoteRaw = Number(r.base_is_token0 === 1 ? r.amount1 : r.amount0)
    const baseRaw = Number(r.base_is_token0 === 1 ? r.amount0 : r.amount1)
    const side: 'buy' | 'sell' = quoteRaw > 0 ? 'buy' : 'sell'
    if (opts.side && side !== opts.side) continue
    const quote = Math.abs(quoteRaw) / 10 ** r.qd
    const isEth = r.q === 'WETH' || r.q === 'ETH'
    const usd = isEth ? (rate ? quote * rate : null) : quote
    if (opts.minUsd && (usd ?? 0) < opts.minUsd) continue
    const qty = Math.abs(baseRaw) / 10 ** r.decimals
    out.push({
      block: r.block,
      ts: r.ts,
      tx: r.tx_hash,
      logIndex: r.log_index,
      pool: r.pool,
      token: r.token,
      symbol: r.symbol,
      side,
      qty,
      quote,
      quoteSymbol: isEth ? 'ETH' : r.q,
      usd,
      price: isEth && qty > 0 ? quote / qty : null,
      trader: r.trader,
      rank: r.trader ? (ranked.get(r.trader) ?? null) : null,
    })
    if (out.length >= limit) break
  }
  return out
}

export interface FreshPool {
  pool: string
  token: string
  symbol: string
  name: string
  version: number
  hooked: boolean
  fee: number
  quoteSymbol: string
  ageSec: number
  swaps: number
  depthQuote: number
}

export function freshPools(limit = 20): FreshPool[] {
  const { tip, rate } = blockRate()
  const rows = db
    .prepare(
      `SELECT p.address AS pool, p.version, p.fee, p.hooks, p.discovered_block, p.swap_count, COALESCE(p.quote_symbol,'WETH') AS q, p.base_is_token0,
              CAST(p.last_liquidity AS REAL) AS liq, CAST(p.last_sqrt_price AS REAL) AS sqrtp, tq.decimals AS qd,
              tb.symbol AS symbol, tb.name AS name, tb.address AS token
       FROM pools p
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0 = 1 THEN p.token1 ELSE p.token0 END
       WHERE p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND p.discovered_block IS NOT NULL AND p.swap_count > 0
         AND upper(tb.symbol) NOT IN ${CASH}
       ORDER BY p.discovered_block DESC LIMIT ?`,
    )
    .all(limit) as {
    pool: string
    version: number
    fee: number
    hooks: string | null
    discovered_block: number
    swap_count: number
    q: string
    base_is_token0: number
    liq: number
    sqrtp: number
    qd: number
    symbol: string
    name: string
    token: string
  }[]
  return rows.map((r) => {
    const sqrt = r.sqrtp / 2 ** 96
    const depthRaw = r.sqrtp > 0 ? (r.base_is_token0 === 1 ? r.liq * sqrt : r.liq / sqrt) : 0
    return {
      pool: r.pool,
      token: r.token,
      symbol: r.symbol,
      name: r.name,
      version: r.version,
      hooked: Boolean(r.hooks && r.hooks !== '0x0000000000000000000000000000000000000000'),
      fee: r.fee,
      quoteSymbol: r.q === 'WETH' ? 'ETH' : r.q,
      ageSec: Math.max(0, Math.round((tip - r.discovered_block) / rate)),
      swaps: r.swap_count,
      depthQuote: depthRaw / 10 ** r.qd,
    }
  })
}

export interface TapeStats {
  tip: number
  /** Seconds between the newest fill in the ledger and now — how far the tape lags the chain. */
  lagSec: number
  blocksPerSec: number
  fills5m: number
  fillsPerMin: number
  fills24h: number
  buys5m: number
  sells5m: number
  /** 24h volume across token pools, ETH-equivalent (from the screener snapshot). */
  volume24hEth: number
  volume24hUsd: number | null
  biggestBuy: TapeFill | null
  biggestSell: TapeFill | null
  trackedWallets: number
}

let statsCache: { at: number; v: TapeStats } | null = null
export function tapeStats(): TapeStats {
  if (statsCache && Date.now() - statsCache.at < 30_000) return statsCache.v
  const { tip, rate, tipTs } = blockRate()
  const now = Math.floor(Date.now() / 1000)
  const count = (sinceBlock: number) => (db.prepare(`SELECT COUNT(*) AS n FROM swaps WHERE block > ?`).get(sinceBlock) as { n: number }).n
  const c5 = count(blocksAgo(300))
  const c24 = count(blocksAgo(86_400))
  // Buys vs sells over the last five minutes — sign of the quote leg, token pools only.
  // (An hour is ~600k rows here; five minutes keeps this under 150ms cold.)
  const window = db
    .prepare(
      `SELECT SUM(CASE WHEN (CASE WHEN p.base_is_token0 = 1 THEN CAST(s.amount1 AS REAL) ELSE CAST(s.amount0 AS REAL) END) > 0 THEN 1 ELSE 0 END) AS buys,
              COUNT(*) AS n
       FROM swaps s CROSS JOIN pools p ON p.address = s.pool
       WHERE s.block > ? AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1`,
    )
    .get(blocksAgo(300)) as { buys: number | null; n: number }
  const usd = ethUsdRate()
  // 24h volume from the watcher's snapshot at any age — never the live screener query, which
  // would block this process's event loop for seconds.
  const volEth = (storedSnapshot(86_400) ?? []).reduce((a, r) => a + (r.quote_symbol === 'USDG' ? (usd ? r.vol24 / usd : 0) : r.vol24), 0)
  // Biggest fills over the last hour.
  const recent = latestFills({ sinceBlock: blocksAgo(3600), limit: 300 })
  const biggest = (side: 'buy' | 'sell') => recent.filter((f) => f.side === side && f.usd !== null).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0] ?? null
  const v: TapeStats = {
    tip,
    lagSec: tipTs ? Math.max(0, now - tipTs) : 0,
    blocksPerSec: rate,
    fills5m: c5,
    fillsPerMin: c5 / 5,
    fills24h: c24,
    buys5m: window.buys ?? 0,
    sells5m: window.n - (window.buys ?? 0),
    volume24hEth: volEth,
    volume24hUsd: usd ? volEth * usd : null,
    biggestBuy: biggest('buy'),
    biggestSell: biggest('sell'),
    trackedWallets: rankedWallets().size,
  }
  statsCache = { at: Date.now(), v }
  return v
}

export function closedTrades(limit = 100): { closes: (TradeClose & { usd: number | null; rank: number | null })[]; ts: number | null } {
  try {
    const ts = Number((db.prepare(`SELECT value FROM meta WHERE key = ?`).get(CLOSED_TS_KEY) as { value: string } | undefined)?.value ?? 0)
    const json = (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(CLOSED_META_KEY) as { value: string } | undefined)?.value
    if (!json) return { closes: [], ts: null }
    const rate = ethUsdRate()
    const ranked = rankedWallets()
    const closes = (JSON.parse(json) as TradeClose[]).slice(0, limit).map((c) => ({ ...c, usd: rate ? c.realized * rate : null, rank: ranked.get(c.trader) ?? null }))
    return { closes, ts: ts || null }
  } catch {
    return { closes: [], ts: null }
  }
}
