/** Price helpers for turning pool sqrt prices into human quote-per-base numbers. */

const Q96 = 2 ** 96

/** Raw token1-per-token0 price from a Q64.96 sqrt price. */
export function rawPriceFromSqrt(sqrtPriceX96: bigint): number {
  const r = Number(sqrtPriceX96) / Q96
  return r * r
}

/**
 * Human-unit price of the base token in quote units.
 * baseIsToken0=true means quote (WETH) is token1.
 */
export function basePriceInQuote(
  sqrtPriceX96: bigint,
  baseIsToken0: boolean,
  baseDecimals: number,
  quoteDecimals: number,
): number {
  const raw = rawPriceFromSqrt(sqrtPriceX96)
  return baseIsToken0
    ? raw * 10 ** (baseDecimals - quoteDecimals)
    : (1 / raw) * 10 ** (baseDecimals - quoteDecimals)
}

/** Human-unit amount from raw bigint. */
export function toHuman(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals
}
