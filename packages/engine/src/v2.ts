import type { Quote, V2PoolState } from './types.js'

const BPS = 10_000n

/** Exact-input output amount under x·y=k with fee taken from input. */
export function v2AmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 30n): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
  const amountInWithFee = amountIn * (BPS - feeBps)
  return (amountInWithFee * reserveOut) / (reserveIn * BPS + amountInWithFee)
}

/** Exact-output input amount (rounded up so the invariant always holds). */
export function v2AmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 30n): bigint {
  if (amountOut <= 0n) return 0n
  if (amountOut >= reserveOut) throw new Error('v2: amountOut exceeds reserves')
  const numerator = reserveIn * amountOut * BPS
  const denominator = (reserveOut - amountOut) * (BPS - feeBps)
  return numerator / denominator + 1n
}

export function quoteV2ExactIn(pool: V2PoolState, amountIn: bigint): Quote {
  const { reserveIn, reserveOut, feeBps } = pool
  const amountOut = v2AmountOut(amountIn, reserveIn, reserveOut, feeBps)
  const feeAmount = (amountIn * feeBps) / BPS

  const spotBefore = Number(reserveOut) / Number(reserveIn)
  const rIn = reserveIn + amountIn
  const rOut = reserveOut - amountOut
  const spotAfter = Number(rOut) / Number(rIn)
  const execPrice = amountIn > 0n ? Number(amountOut) / Number(amountIn) : 0
  // Impact excludes the fee: compare against the fill the fee-free input would get at mid.
  const execExclFee = amountIn - feeAmount > 0n ? Number(amountOut) / Number(amountIn - feeAmount) : 0
  const priceImpactBps = spotBefore > 0 ? Math.max(0, (1 - execExclFee / spotBefore) * 10_000) : 0

  return {
    amountIn,
    amountOut,
    feeAmount,
    sqrtPriceX96After: 0n,
    tickAfter: 0,
    liquidityAfter: 0n,
    ticksCrossed: 0,
    fillRatio: 1,
    exhaustedWindow: false,
    executionPrice: execPrice,
    spotPriceBefore: spotBefore,
    spotPriceAfter: spotAfter,
    priceImpactBps,
    feeBps: Number(feeBps),
  }
}
