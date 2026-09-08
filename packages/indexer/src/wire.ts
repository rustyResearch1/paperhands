import type Database from 'better-sqlite3'
import { setMeta } from './db.js'

/**
 * The Wire ranking — wallets by ETH actually taken out of pools — aggregates
 * every attributed swap, which is tens of seconds on a full ledger. The web
 * must never pay that on a request, so the watch loop refreshes this table
 * every few minutes and the web reads it.
 */
const ETH_EXPR = `CAST(CASE WHEN p.base_is_token0 = 1 THEN s.amount1 ELSE s.amount0 END AS REAL) / 1e18`
const BASE_EXPR = `CAST(CASE WHEN p.base_is_token0 = 1 THEN s.amount0 ELSE s.amount1 END AS REAL)`

export const WIRE_RANK_ROWS = 200
export const WIRE_RANK_MIN_TRADES = 5

export function ensureWireRank(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS wire_rank (
    rank INTEGER PRIMARY KEY,
    trader TEXT NOT NULL,
    trades INTEGER NOT NULL,
    buys INTEGER NOT NULL,
    sells INTEGER NOT NULL,
    vol_eth REAL NOT NULL,
    net_flow_eth REAL NOT NULL,
    pools INTEGER NOT NULL,
    last_ts INTEGER NOT NULL,
    open_mark_eth REAL NOT NULL
  )`)
}

export interface WireRankRow {
  trader: string
  trades: number
  buys: number
  sells: number
  volEth: number
  netFlowEth: number
  pools: number
  lastTs: number
  openMarkEth: number
}

export function computeWireRank(db: Database.Database, limit = WIRE_RANK_ROWS, minTrades = WIRE_RANK_MIN_TRADES): WireRankRow[] {
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
    .all({ min: minTrades, limit }) as Omit<WireRankRow, 'openMarkEth'>[]
  if (rows.length === 0) return []
  const placeholders = rows.map(() => '?').join(',')
  const marks = db
    .prepare(
      `SELECT s.trader AS trader, -SUM(${BASE_EXPR}) AS netBaseRaw, tb.decimals AS decimals,
              (SELECT close FROM candles c WHERE c.pool = s.pool ORDER BY minute_ts DESC LIMIT 1) AS close
       FROM swaps s
       JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader IN (${placeholders}) AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
       GROUP BY s.trader, s.pool`,
    )
    .all(...rows.map((r) => r.trader)) as { trader: string; netBaseRaw: number; decimals: number; close: number | null }[]
  const open = new Map<string, number>()
  for (const m of marks) {
    if (m.netBaseRaw <= 0 || !m.close) continue
    open.set(m.trader, (open.get(m.trader) ?? 0) + (m.netBaseRaw / 10 ** m.decimals) * m.close)
  }
  return rows.map((r) => ({ ...r, openMarkEth: open.get(r.trader) ?? 0 }))
}

/** Recompute and swap the table in one transaction; returns rows written. */
export function refreshWireRank(db: Database.Database): number {
  ensureWireRank(db)
  const rows = computeWireRank(db)
  const insert = db.prepare(
    `INSERT INTO wire_rank (rank, trader, trades, buys, sells, vol_eth, net_flow_eth, pools, last_ts, open_mark_eth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  db.transaction(() => {
    db.exec('DELETE FROM wire_rank')
    rows.forEach((r, i) => insert.run(i + 1, r.trader, r.trades, r.buys, r.sells, r.volEth, r.netFlowEth, r.pools, r.lastTs, r.openMarkEth))
    setMeta(db, 'wire_rank_ts', String(Math.floor(Date.now() / 1000)))
  })()
  return rows.length
}
