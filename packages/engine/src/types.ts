export type Address = `0x${string}`

/** One initialized tick. liquidityNet is added when crossing left-to-right (price up). */
export interface TickData {
  tick: number
  liquidityNet: bigint
}

export interface V2PoolState {
  reserveIn: bigint
  reserveOut: bigint
  /** LP fee in basis points (Uniswap v2 = 30). */
  feeBps: bigint
}

export interface V3PoolState {
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
  /** Fee in hundredths of a bip (pips): 500 | 3000 | 10000. */
  feePips: number
  tickSpacing: number
  /** Initialized ticks sorted ascending. Must cover the range a swap can reach. */
  ticks: TickData[]
  /**
   * Tick range actually covered by `ticks`. A swap that walks past this
   * window is reported as a partial fill rather than silently assuming
   * zero liquidity beyond it.
   */
  tickWindow?: { min: number; max: number }
}

export interface SwapResult {
  /** Input consumed, including fee. */
  amountIn: bigint
  amountOut: bigint
  /** LP fee paid, denominated in the input token. */
  feeAmount: bigint
  sqrtPriceX96After: bigint
  tickAfter: number
  liquidityAfter: bigint
  ticksCrossed: number
  /**
   * amountIn / amountRequested. 1 means fully filled. Below 1 the pool ran
   * out of usable liquidity (or the known tick window) before filling.
   */
  fillRatio: number
  /** True when the swap walked past the known tick window — result is a floor, not exact. */
  exhaustedWindow: boolean
}

export interface Quote extends SwapResult {
  /** Raw-unit execution price out/in, fee included. Adjust by decimals for display. */
  executionPrice: number
  /** Raw-unit mid price before the swap. */
  spotPriceBefore: number
  /** Raw-unit mid price after the swap. */
  spotPriceAfter: number
  /**
   * Price impact in basis points, fee excluded (fee is reported separately),
   * i.e. how much worse than mid the fill itself was.
   */
  priceImpactBps: number
  /** LP fee in basis points of input. */
  feeBps: number
}

export interface RoundTrip {
  buy: Quote
  sell: Quote
  /** What fraction of the quote currency survives buy → immediate full sell. */
  retention: number
  /** Total round-trip cost in bps: 10000 * (1 - retention). */
  costBps: number
  /** Position value a PnL screen would show right after the buy: qty × post-buy spot. */
  markValueQuote: number
  /** What the pool would actually pay to exit the position. */
  realizableQuote: number
  /**
   * markValueQuote / realizableQuote. 1 = honest mark. 6 = your unrealized
   * PnL overstates reality six-fold. This — not round-trip fees — is how
   * thin liquidity lies to you.
   */
  markInflation: number
}
