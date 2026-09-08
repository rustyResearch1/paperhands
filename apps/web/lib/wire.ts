import { db } from './db'

/**
 * Wallet analytics from attributed swaps. ETH figures use REAL casts —
 * display-grade precision, not accounting-grade — and only factory-verified,
 * WETH-quoted pools count.
 */

const ETH_EXPR = `CAST(CASE WHEN p.base_is_token0 = 1 THEN s.amount1 ELSE s.amount0 END AS REAL) / 1e18`
const BASE_EXPR = `CAST(CASE WHEN p.base_is_token0 = 1 THEN s.amount0 ELSE s.amount1 END AS REAL)`

export interface WireRow {
  trader: string
  trades: number
  buys: number
  sells: number
  volEth: number
  /** ETH taken out of pools minus ETH put in, over the tracked window. */
  netFlowEth: number
  pools: number
  lastTs: number
  /** Marked value of net base holdings accumulated in-window. */
  openMarkEth: number
}

const wireCache = new Map<string, { at: number; rows: WireRow[] }>()
const WIRE_CACHE_MS = 60_000
/** How stale the indexer's precomputed ranking may be before we compute live. */
const RANK_FRESH_S = 30 * 60

/**
 * Ranked wallets. The indexer refreshes a `wire_rank` table every few minutes
 * (the ranking scans every attributed swap — tens of seconds on a full
 * ledger); we serve that. Live computation is the fallback for a fresh
 * database, cached for a minute.
 */
export function topTraders(limit = 50, minTrades = 5): WireRow[] {
  const precomputed = rankedFromTable(limit, minTrades)
  if (precomputed) return precomputed
  const key = `${limit}:${minTrades}`
  const hit = wireCache.get(key)
  if (hit && Date.now() - hit.at < WIRE_CACHE_MS) return hit.rows
  const rows = computeTopTraders(limit, minTrades)
  wireCache.set(key, { at: Date.now(), rows })
  return rows
}

function rankedFromTable(limit: number, minTrades: number): WireRow[] | null {
  try {
    const ts = Number((db.prepare(`SELECT value FROM meta WHERE key = 'wire_rank_ts'`).get() as { value: string } | undefined)?.value ?? 0)
    if (!ts || Math.floor(Date.now() / 1000) - ts > RANK_FRESH_S) return null
    const rows = db
      .prepare(
        `SELECT trader, trades, buys, sells, vol_eth AS volEth, net_flow_eth AS netFlowEth, pools, last_ts AS lastTs, open_mark_eth AS openMarkEth
         FROM wire_rank WHERE trades >= ? ORDER BY rank LIMIT ?`,
      )
      .all(minTrades, limit) as WireRow[]
    return rows.length > 0 ? rows : null
  } catch {
    return null // table not created yet
  }
}

function computeTopTraders(limit: number, minTrades: number): WireRow[] {
  const rows = db
    .prepare(
      `SELECT trader, COUNT(*) AS trades, SUM(eth > 0) AS buys, SUM(eth < 0) AS sells,
              SUM(ABS(eth)) AS volEth, -SUM(eth) AS netFlowEth,
              COUNT(DISTINCT pool) AS pools, MAX(ts) AS lastTs
       FROM (SELECT s.trader, s.pool, s.ts, ${ETH_EXPR} AS eth
             FROM swaps s JOIN pools p ON p.address = s.pool
             WHERE s.trader IS NOT NULL AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH'))
       GROUP BY trader HAVING trades >= @min
       ORDER BY netFlowEth DESC LIMIT @limit`,
    )
    .all({ min: minTrades, limit }) as Omit<WireRow, 'openMarkEth'>[]

  if (rows.length === 0) return []
  const marks = openMarks(rows.map((r) => r.trader))
  return rows.map((r) => ({ ...r, openMarkEth: marks.get(r.trader) ?? 0 }))
}

function openMarks(traders: string[]): Map<string, number> {
  const placeholders = traders.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT s.trader AS trader,
              -SUM(${BASE_EXPR}) AS netBaseRaw,
              tb.decimals AS decimals,
              (SELECT close FROM candles c WHERE c.pool = s.pool ORDER BY minute_ts DESC LIMIT 1) AS close
       FROM swaps s
       JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader IN (${placeholders}) AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
       GROUP BY s.trader, s.pool`,
    )
    .all(...traders) as { trader: string; netBaseRaw: number; decimals: number; close: number | null }[]
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.netBaseRaw <= 0 || !r.close) continue
    out.set(r.trader, (out.get(r.trader) ?? 0) + (r.netBaseRaw / 10 ** r.decimals) * r.close)
  }
  return out
}

export interface WalletPoolRow {
  pool: string
  symbol: string
  decimals: number
  buys: number
  sells: number
  ethIn: number
  ethOut: number
  netBaseRaw: number
  close: number | null
}

export function walletPools(trader: string): WalletPoolRow[] {
  return db
    .prepare(
      `SELECT s.pool AS pool, tb.symbol AS symbol, tb.decimals AS decimals,
              SUM(${ETH_EXPR} > 0) AS buys, SUM(${ETH_EXPR} < 0) AS sells,
              SUM(CASE WHEN ${ETH_EXPR} > 0 THEN ${ETH_EXPR} ELSE 0 END) AS ethIn,
              SUM(CASE WHEN ${ETH_EXPR} < 0 THEN -(${ETH_EXPR}) ELSE 0 END) AS ethOut,
              -SUM(${BASE_EXPR}) AS netBaseRaw,
              (SELECT close FROM candles c WHERE c.pool = s.pool ORDER BY minute_ts DESC LIMIT 1) AS close
       FROM swaps s
       JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader = ? AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
       GROUP BY s.pool ORDER BY ethIn + ethOut DESC LIMIT 40`,
    )
    .all(trader.toLowerCase()) as WalletPoolRow[]
}

export interface WalletSwapRow {
  pool: string
  symbol: string
  ts: number
  eth: number
  tx_hash: string
}

export function walletRecentSwaps(trader: string, limit = 30): WalletSwapRow[] {
  return db
    .prepare(
      `SELECT s.pool AS pool, tb.symbol AS symbol, s.ts AS ts, ${ETH_EXPR} AS eth, s.tx_hash AS tx_hash
       FROM swaps s
       JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader = ? AND p.base_is_token0 IS NOT NULL AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
       ORDER BY s.block DESC, s.log_index DESC LIMIT ?`,
    )
    .all(trader.toLowerCase(), limit) as WalletSwapRow[]
}
