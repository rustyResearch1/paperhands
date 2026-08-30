import { db } from './db'

export interface ScreenerRow {
  address: string
  fee: number
  base_is_token0: number
  factory_verified: number
  last_sqrt_price: string | null
  last_liquidity: string | null
  swap_count: number
  baseSymbol: string
  baseName: string
  baseDecimals: number
  baseAddr: string
  lastClose: number | null
  close5m: number | null
  close30m: number | null
  vol24: number
  trades24: number
}

export function screenerRows(limit = 100): ScreenerRow[] {
  const now = Math.floor(Date.now() / 1000)
  return db
    .prepare(
      `SELECT p.address, p.fee, p.base_is_token0, p.factory_verified, p.last_sqrt_price, p.last_liquidity, p.swap_count,
        tb.symbol AS baseSymbol, tb.name AS baseName, tb.decimals AS baseDecimals, tb.address AS baseAddr,
        (SELECT close FROM candles c WHERE c.pool = p.address ORDER BY minute_ts DESC LIMIT 1) AS lastClose,
        (SELECT close FROM candles c WHERE c.pool = p.address AND c.minute_ts <= @t5 ORDER BY minute_ts DESC LIMIT 1) AS close5m,
        (SELECT close FROM candles c WHERE c.pool = p.address AND c.minute_ts <= @t30 ORDER BY minute_ts DESC LIMIT 1) AS close30m,
        (SELECT COALESCE(SUM(vol_quote), 0) FROM candles c WHERE c.pool = p.address AND c.minute_ts > @t24h) AS vol24,
        (SELECT COALESCE(SUM(trades), 0) FROM candles c WHERE c.pool = p.address AND c.minute_ts > @t24h) AS trades24
      FROM pools p
      JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
      WHERE p.base_is_token0 IS NOT NULL
      ORDER BY vol24 DESC
      LIMIT @limit`,
    )
    .all({ t5: now - 300, t30: now - 1800, t24h: now - 86400, limit }) as ScreenerRow[]
}

/** Virtual in-range ETH-side depth of a pool, from its cached state. */
export function ethDepth(row: Pick<ScreenerRow, 'last_sqrt_price' | 'last_liquidity' | 'base_is_token0'>): number {
  if (!row.last_sqrt_price || !row.last_liquidity) return 0
  const sqrtP = Number(row.last_sqrt_price) / 2 ** 96
  const L = Number(row.last_liquidity)
  const reserve = row.base_is_token0 === 1 ? L * sqrtP : sqrtP > 0 ? L / sqrtP : 0
  return reserve / 1e18
}

export function pctChange(now: number | null, then: number | null): number | null {
  if (!now || !then || then === 0) return null
  return ((now - then) / then) * 100
}
