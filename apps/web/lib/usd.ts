import { db } from './db'

/**
 * ETH/USD from the chain itself: the deepest verified USDG (Global Dollar)
 * pool's last candle is ETH-per-USDG, so its inverse prices ETH in dollars.
 * No external API, same trust base as everything else on the site.
 */
let cache: { rate: number; at: number } | null = null

export function ethUsdRate(): number | null {
  if (cache && Date.now() - cache.at < 30_000) return cache.rate
  const row = db
    .prepare(
      `SELECT (SELECT close FROM candles c WHERE c.pool = p.address ORDER BY minute_ts DESC LIMIT 1) AS close
       FROM pools p
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE tb.symbol = 'USDG' AND p.factory_verified = 1 AND p.base_is_token0 IS NOT NULL
       ORDER BY p.swap_count DESC LIMIT 1`,
    )
    .get() as { close: number | null } | undefined
  if (!row?.close || row.close <= 0) return cache?.rate ?? null
  const rate = 1 / row.close
  if (rate < 100 || rate > 100_000) return cache?.rate ?? null // sanity: USD per ETH
  cache = { rate, at: Date.now() }
  return rate
}
