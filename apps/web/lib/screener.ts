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
  /** Volume in the last 30 minutes vs the 30 minutes before — traction. */
  vol30: number
  vol30prev: number
}

export type ScreenerSort = 'vol' | 'traction' | 'change5m' | 'change30m' | 'trades' | 'depth'

let rowCache: { rows: ScreenerRow[]; at: number } | null = null

export function screenerRows(limit = 100, sort: ScreenerSort = 'vol', minDepthEth = 0): ScreenerRow[] {
  // One heavy candle-aggregate query per 5s regardless of visitors/sorts.
  if (rowCache && Date.now() - rowCache.at < 5000) {
    return sortAndTrim(rowCache.rows, limit, sort, minDepthEth)
  }
  const now = Math.floor(Date.now() / 1000)
  const rows = db
    .prepare(
      `SELECT p.address, p.fee, p.base_is_token0, p.factory_verified, p.last_sqrt_price, p.last_liquidity, p.swap_count,
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
      WHERE p.base_is_token0 IS NOT NULL
      ORDER BY vol24 DESC
      LIMIT 400`,
    )
    .all({ t5: now - 300, t30: now - 1800, t60: now - 3600, t24h: now - 86400 }) as ScreenerRow[]
  rowCache = { rows, at: Date.now() }
  return sortAndTrim(rows, limit, sort, minDepthEth)
}

function sortAndTrim(rows: ScreenerRow[], limit: number, sort: ScreenerSort, minDepthEth: number): ScreenerRow[] {
  const filtered = minDepthEth > 0 ? rows.filter((r) => ethDepth(r) >= minDepthEth) : rows
  const key: Record<ScreenerSort, (r: ScreenerRow) => number> = {
    vol: (r) => r.vol24,
    traction: (r) => tractionScore(r),
    change5m: (r) => pctChange(r.lastClose, r.close5m) ?? -Infinity,
    change30m: (r) => pctChange(r.lastClose, r.close30m) ?? -Infinity,
    trades: (r) => r.trades24,
    depth: (r) => ethDepth(r),
  }
  return [...filtered].sort((a, b) => key[sort](b) - key[sort](a)).slice(0, limit)
}

/**
 * Traction = volume acceleration, damped by absolute size so a 0.01→0.1 ETH
 * blip doesn't outrank a 20→60 ETH surge: log-volume times the accel ratio.
 */
export function tractionScore(r: Pick<ScreenerRow, 'vol30' | 'vol30prev'>): number {
  if (r.vol30 <= 0) return -Infinity
  const accel = r.vol30 / Math.max(r.vol30prev, 0.05)
  return Math.log10(1 + r.vol30) * Math.min(accel, 50)
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
