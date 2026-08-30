/**
 * Exact ports of Uniswap v3 core math libraries (FullMath, TickMath,
 * SqrtPriceMath, SwapMath) to native bigint.
 *
 * Solidity's uint256 wrapping never fires on the paths we take: bigint is
 * arbitrary precision, so we always compute the mathematically exact branch —
 * the same one the contracts take whenever their intermediate products fit
 * in 256/512 bits (i.e. every realistic swap). Correctness is enforced by the
 * live cross-check against the chain's QuoterV2 in @paperhands/chain.
 */

export const Q96 = 2n ** 96n
export const MIN_TICK = -887272
export const MAX_TICK = 887272
export const MIN_SQRT_RATIO = 4295128739n
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n

const MAX_UINT256 = 2n ** 256n - 1n

// ---------------------------------------------------------------- FullMath

export function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('mulDiv: division by zero')
  return (a * b) / denominator
}

export function mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
  const product = a * b
  let result = product / denominator
  if (product % denominator !== 0n) result += 1n
  return result
}

export function divRoundingUp(numerator: bigint, denominator: bigint): bigint {
  return numerator / denominator + (numerator % denominator === 0n ? 0n : 1n)
}

// ---------------------------------------------------------------- TickMath

/** sqrt(1.0001^tick) * 2^96, bit-exact with TickMath.getSqrtRatioAtTick. */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) throw new Error(`tick out of range: ${tick}`)
  const absTick = BigInt(tick < 0 ? -tick : tick)

  let ratio = (absTick & 1n) !== 0n
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : 0x100000000000000000000000000000000n
  if ((absTick & 0x2n) !== 0n) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n
  if ((absTick & 0x4n) !== 0n) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n
  if ((absTick & 0x8n) !== 0n) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n
  if ((absTick & 0x10n) !== 0n) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n
  if ((absTick & 0x20n) !== 0n) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n
  if ((absTick & 0x40n) !== 0n) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n
  if ((absTick & 0x80n) !== 0n) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n
  if ((absTick & 0x100n) !== 0n) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n
  if ((absTick & 0x200n) !== 0n) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n
  if ((absTick & 0x400n) !== 0n) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n
  if ((absTick & 0x800n) !== 0n) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n
  if ((absTick & 0x1000n) !== 0n) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n
  if ((absTick & 0x2000n) !== 0n) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n
  if ((absTick & 0x4000n) !== 0n) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n
  if ((absTick & 0x8000n) !== 0n) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n
  if ((absTick & 0x10000n) !== 0n) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n
  if ((absTick & 0x20000n) !== 0n) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n
  if ((absTick & 0x40000n) !== 0n) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n
  if ((absTick & 0x80000n) !== 0n) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n

  if (tick > 0) ratio = MAX_UINT256 / ratio

  // Q128.128 -> Q64.96, rounding up.
  return (ratio >> 32n) + ((ratio & 0xffffffffn) === 0n ? 0n : 1n)
}

/**
 * Greatest tick whose ratio is <= sqrtRatioX96 (same contract as
 * TickMath.getTickAtSqrtRatio). Binary search against the exact forward
 * function instead of a second magic-constant table: slower, but provably
 * consistent with getSqrtRatioAtTick.
 */
export function getTickAtSqrtRatio(sqrtRatioX96: bigint): number {
  if (sqrtRatioX96 < MIN_SQRT_RATIO || sqrtRatioX96 >= MAX_SQRT_RATIO) {
    throw new Error(`sqrtRatio out of range: ${sqrtRatioX96}`)
  }
  let low = MIN_TICK
  let high = MAX_TICK
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (getSqrtRatioAtTick(mid) <= sqrtRatioX96) low = mid
    else high = mid - 1
  }
  return low
}

// ---------------------------------------------------------- SqrtPriceMath

export function getNextSqrtPriceFromAmount0RoundingUp(
  sqrtPX96: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean,
): bigint {
  if (amount === 0n) return sqrtPX96
  const numerator1 = liquidity << 96n
  const product = amount * sqrtPX96
  if (add) {
    return mulDivRoundingUp(numerator1, sqrtPX96, numerator1 + product)
  }
  if (numerator1 <= product) throw new Error('sqrtPriceMath: amount0 removal underflow')
  return mulDivRoundingUp(numerator1, sqrtPX96, numerator1 - product)
}

export function getNextSqrtPriceFromAmount1RoundingDown(
  sqrtPX96: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean,
): bigint {
  if (add) {
    return sqrtPX96 + (amount << 96n) / liquidity
  }
  const quotient = divRoundingUp(amount << 96n, liquidity)
  if (sqrtPX96 <= quotient) throw new Error('sqrtPriceMath: amount1 removal underflow')
  return sqrtPX96 - quotient
}

export function getNextSqrtPriceFromInput(
  sqrtPX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean,
): bigint {
  if (sqrtPX96 <= 0n || liquidity <= 0n) throw new Error('sqrtPriceMath: bad state')
  return zeroForOne
    ? getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountIn, true)
    : getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountIn, true)
}

export function getNextSqrtPriceFromOutput(
  sqrtPX96: bigint,
  liquidity: bigint,
  amountOut: bigint,
  zeroForOne: boolean,
): bigint {
  if (sqrtPX96 <= 0n || liquidity <= 0n) throw new Error('sqrtPriceMath: bad state')
  return zeroForOne
    ? getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountOut, false)
    : getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountOut, false)
}

/** token0 owed between two prices for `liquidity`; caller pre-sorts nothing, we sort. */
export function getAmount0Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  let [lower, upper] =
    sqrtRatioAX96 <= sqrtRatioBX96 ? [sqrtRatioAX96, sqrtRatioBX96] : [sqrtRatioBX96, sqrtRatioAX96]
  if (lower <= 0n) throw new Error('sqrtPriceMath: zero price')
  const numerator1 = liquidity << 96n
  const numerator2 = upper - lower
  return roundUp
    ? divRoundingUp(mulDivRoundingUp(numerator1, numerator2, upper), lower)
    : mulDiv(numerator1, numerator2, upper) / lower
}

export function getAmount1Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [lower, upper] =
    sqrtRatioAX96 <= sqrtRatioBX96 ? [sqrtRatioAX96, sqrtRatioBX96] : [sqrtRatioBX96, sqrtRatioAX96]
  return roundUp ? mulDivRoundingUp(liquidity, upper - lower, Q96) : mulDiv(liquidity, upper - lower, Q96)
}

// --------------------------------------------------------------- SwapMath

export interface SwapStep {
  sqrtRatioNextX96: bigint
  amountIn: bigint
  amountOut: bigint
  feeAmount: bigint
}

const FEE_DENOM = 1_000_000n

/** One step of the swap loop: move price toward target until amountRemaining runs out. */
export function computeSwapStep(
  sqrtRatioCurrentX96: bigint,
  sqrtRatioTargetX96: bigint,
  liquidity: bigint,
  amountRemaining: bigint,
  feePips: number,
): SwapStep {
  const fee = BigInt(feePips)
  const zeroForOne = sqrtRatioCurrentX96 >= sqrtRatioTargetX96
  const exactIn = amountRemaining >= 0n

  let sqrtRatioNextX96: bigint
  let amountIn = 0n
  let amountOut = 0n
  let feeAmount: bigint

  if (exactIn) {
    const amountRemainingLessFee = mulDiv(amountRemaining, FEE_DENOM - fee, FEE_DENOM)
    amountIn = zeroForOne
      ? getAmount0Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, true)
      : getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, true)
    sqrtRatioNextX96 =
      amountRemainingLessFee >= amountIn
        ? sqrtRatioTargetX96
        : getNextSqrtPriceFromInput(sqrtRatioCurrentX96, liquidity, amountRemainingLessFee, zeroForOne)
  } else {
    amountOut = zeroForOne
      ? getAmount1Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, false)
      : getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, false)
    sqrtRatioNextX96 =
      -amountRemaining >= amountOut
        ? sqrtRatioTargetX96
        : getNextSqrtPriceFromOutput(sqrtRatioCurrentX96, liquidity, -amountRemaining, zeroForOne)
  }

  const max = sqrtRatioTargetX96 === sqrtRatioNextX96

  if (zeroForOne) {
    amountIn =
      max && exactIn ? amountIn : getAmount0Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, true)
    amountOut =
      max && !exactIn ? amountOut : getAmount1Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, false)
  } else {
    amountIn =
      max && exactIn ? amountIn : getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, true)
    amountOut =
      max && !exactIn ? amountOut : getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, false)
  }

  if (!exactIn && amountOut > -amountRemaining) {
    amountOut = -amountRemaining
  }

  if (exactIn && sqrtRatioNextX96 !== sqrtRatioTargetX96) {
    // Didn't reach the target: whatever input remains after amountIn is fee.
    feeAmount = amountRemaining - amountIn
  } else {
    feeAmount = mulDivRoundingUp(amountIn, fee, FEE_DENOM - fee)
  }

  return { sqrtRatioNextX96, amountIn, amountOut, feeAmount }
}
