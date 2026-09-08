import type Database from 'better-sqlite3'
import { setMeta } from './db.js'

/**
 * The Markets screener's heavy candle aggregation, computed by the watch loop
 * every minute and stored as JSON so the web never pays for it on a request
 * (it is ~10s cold on a full ledger).
 */
export interface ScreenerSnapshotRow {
  address: string
  fee: number
  base_is_token0: number
  factory_verified: number
  last_sqrt_price: string | null
  last_liquidity: string | null
  swap_count: number
  quote_symbol: string
  quoteDecimals: number
  baseSymbol: string
  baseName: string
  baseDecimals: number
  baseAddr: string
  lastClose: number | null
  close5m: number | null
  close30m: number | null
  vol24: number
  trades24: number
  vol30: number
  vol30prev: number
}

export const SCREENER_META_KEY = 'screener_json'
export const SCREENER_TS_KEY = 'screener_ts'

export function screenerSnapshot(db: Database.Database, now = Math.floor(Date.now() / 1000)): ScreenerSnapshotRow[] {
  return db
    .prepare(
      `SELECT p.address, p.fee, p.base_is_token0, p.factory_verified, p.last_sqrt_price, p.last_liquidity, p.swap_count,
        COALESCE(p.quote_symbol, 'WETH') AS quote_symbol, tq.decimals AS quoteDecimals,
        tb.symbol AS baseSymbol, tb.name AS baseName, tb.decimals AS baseDecimals, tb.address AS baseAddr,
        (SELECT close FROM candles c WHERE c.pool = p.address ORDER BY minute_ts DESC LIMIT 1) AS lastClose,
        (SELECT close FROM candles c WHERE c.pool = p.address AND c.minute_ts <= @t5 ORDER BY minute_ts DESC LIMIT 1) AS close5m,
        (SELECT close FROM candles c WHERE c.pool = p.address AND c.minute_ts <= @t30 ORDER BY minute_ts DESC LIMIT 1) AS close30m,
        (SELECT COALESCE(SUM(vol_quote), 0) FROM candles c WHERE c.pool = p.address AND c.minute_ts > @t24h) AS vol24,
        (SELECT COALESCE(SUM(trades), 0) FROM candles c WHERE c.pool = p.address AND c.minute_ts > @t24h) AS trades24,
        (SELECT COALESCE(SUM(vol_quote), 0) FROM candles c WHERE c.pool = p.address AND c.minute_ts > @t30) AS vol30,
        (SELECT COALESCE(SUM(vol_quote), 0) FROM candles c WHERE c.pool = p.address AND c.minute_ts > @t60 AND c.minute_ts <= @t30) AS vol30prev
      FROM pools p
      JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
      JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0 = 1 THEN p.token1 ELSE p.token0 END
      WHERE p.base_is_token0 IS NOT NULL
      ORDER BY vol24 DESC
      LIMIT 400`,
    )
    .all({ t5: now - 300, t30: now - 1800, t60: now - 3600, t24h: now - 86400 }) as ScreenerSnapshotRow[]
}

/** Recompute and store the snapshot; returns the row count. */
export function refreshScreener(db: Database.Database): number {
  const rows = screenerSnapshot(db)
  setMeta(db, SCREENER_META_KEY, JSON.stringify(rows))
  setMeta(db, SCREENER_TS_KEY, String(Math.floor(Date.now() / 1000)))
  return rows.length
}
