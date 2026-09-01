/** Port of periphery LiquidityAmounts: position sizing math. */
import { Q96, getAmount0Delta, getAmount1Delta, mulDiv } from './math.js'

function sortRatios(a: bigint, b: bigint): [bigint, bigint] {
  return a <= b ? [a, b] : [b, a]
}

export function getLiquidityForAmount0(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, amount0: bigint): bigint {
  const [lower, upper] = sortRatios(sqrtRatioAX96, sqrtRatioBX96)
  const intermediate = mulDiv(lower, upper, Q96)
  return mulDiv(amount0, intermediate, upper - lower)
}

export function getLiquidityForAmount1(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, amount1: bigint): bigint {
  const [lower, upper] = sortRatios(sqrtRatioAX96, sqrtRatioBX96)
  return mulDiv(amount1, Q96, upper - lower)
}

/** Max liquidity fundable by both amounts at the current price. */
export function getLiquidityForAmounts(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const [lower, upper] = sortRatios(sqrtRatioAX96, sqrtRatioBX96)
  if (sqrtRatioX96 <= lower) return getLiquidityForAmount0(lower, upper, amount0)
  if (sqrtRatioX96 < upper) {
    const l0 = getLiquidityForAmount0(sqrtRatioX96, upper, amount0)
    const l1 = getLiquidityForAmount1(lower, sqrtRatioX96, amount1)
    return l0 < l1 ? l0 : l1
  }
  return getLiquidityForAmount1(lower, upper, amount1)
}

/** Token amounts a position of `liquidity` holds at the current price. */
export function getAmountsForLiquidity(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  const [lower, upper] = sortRatios(sqrtRatioAX96, sqrtRatioBX96)
  if (sqrtRatioX96 <= lower) {
    return { amount0: getAmount0Delta(lower, upper, liquidity, false), amount1: 0n }
  }
  if (sqrtRatioX96 < upper) {
    return {
      amount0: getAmount0Delta(sqrtRatioX96, upper, liquidity, false),
      amount1: getAmount1Delta(lower, sqrtRatioX96, liquidity, false),
    }
  }
  return { amount0: 0n, amount1: getAmount1Delta(lower, upper, liquidity, false) }
}
