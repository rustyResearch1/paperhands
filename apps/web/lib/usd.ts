import { db } from './db'

/**
 * ETH/USD from the chain itself: the deepest verified USDG (Global Dollar)
 * pool's last candle is ETH-per-USDG, so its inverse prices ETH in dollars.
 * No external API, same trust base as everything else on the site.
 */
let cache: { rate: number; at: number } | null = null
let facePool: { address: string | null; at: number } | null = null

/** Which pool is the dollar face changes rarely; its price changes constantly. */
function faceUsdgPool(): string | null {
  if (facePool && Date.now() - facePool.at < 10 * 60_000) return facePool.address
  const row = db
    .prepare(
      `SELECT p.address FROM pools p
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE tb.symbol = 'USDG' AND p.factory_verified = 1 AND p.base_is_token0 IS NOT NULL
       ORDER BY p.swap_count DESC LIMIT 1`,
    )
    .get() as { address: string } | undefined
  facePool = { address: row?.address ?? null, at: Date.now() }
  return facePool.address
}

export function ethUsdRate(): number | null {
  if (cache && Date.now() - cache.at < 30_000) return cache.rate
  const pool = faceUsdgPool()
  if (!pool) return cache?.rate ?? null
  const row = db.prepare(`SELECT close FROM candles WHERE pool = ? ORDER BY minute_ts DESC LIMIT 1`).get(pool) as { close: number | null } | undefined
  if (!row?.close || row.close <= 0) return cache?.rate ?? null
  const rate = 1 / row.close
  if (rate < 100 || rate > 100_000) return cache?.rate ?? null // sanity: USD per ETH
  cache = { rate, at: Date.now() }
  return rate
}
