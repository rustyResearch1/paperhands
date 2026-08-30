import type { Quote, RoundTrip, V3PoolState } from './types.js'
import { poolStateAfter, quoteV3ExactIn } from './v3/swap.js'

/**
 * The core honesty metric: buy with `quoteAmountIn` of the quote token, then
 * immediately sell everything back into the pool you just moved. `retention`
 * is the fraction of your money that survives the trip — for a thin memecoin
 * pool this is what mark-to-market PnL quietly lies about.
 *
 * `baseIsToken0` — whether the memecoin is token0 in the pool.
 */
export function roundTripV3(pool: V3PoolState, quoteAmountIn: bigint, baseIsToken0: boolean): RoundTrip {
  const buy: Quote = quoteV3ExactIn(pool, quoteAmountIn, !baseIsToken0)
  const afterBuy = poolStateAfter(pool, buy)
  const sell: Quote = quoteV3ExactIn(afterBuy, buy.amountOut, baseIsToken0)

  const retention = quoteAmountIn > 0n ? Number(sell.amountOut) / Number(quoteAmountIn) : 1
  // buy.spotPriceAfter is base-per-quote; invert to price the bag in quote.
  const spotBaseInQuote = buy.spotPriceAfter > 0 ? 1 / buy.spotPriceAfter : 0
  const markValueQuote = Number(buy.amountOut) * spotBaseInQuote
  const realizableQuote = Number(sell.amountOut)
  return {
    buy,
    sell,
    retention,
    costBps: (1 - retention) * 10_000,
    markValueQuote,
    realizableQuote,
    markInflation: realizableQuote > 0 ? markValueQuote / realizableQuote : Infinity,
  }
}

/**
 * What the pool would actually pay right now to exit `qty` of the base token.
 * This — not spot price × qty — is what a position is worth.
 */
export function realizableValueV3(pool: V3PoolState, qty: bigint, baseIsToken0: boolean): Quote {
  return quoteV3ExactIn(pool, qty, baseIsToken0)
}
