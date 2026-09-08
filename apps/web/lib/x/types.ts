/**
 * Cross-chain layer. One quote shape for every chain so the ticket, the
 * portfolio and the public API never care where a token lives — while each
 * adapter keeps its own honesty: exact engine math where we can run it
 * (Robinhood Chain, PancakeSwap v3 on BSC), the best aggregator where we
 * can't (Jupiter on Solana), and a real "sold right back" quote everywhere.
 */
export type XChain = 'rh' | 'sol' | 'bsc'

export const X_CHAINS: XChain[] = ['rh', 'sol', 'bsc']

export interface XNative {
  symbol: string
  decimals: number
  /** Address the adapter uses for the native asset in quotes. */
  address: string
  /** Wrapped ERC20 form, where one exists. */
  wrapped?: string
}

export const NATIVE: Record<XChain, XNative> = {
  rh: { symbol: 'ETH', decimals: 18, address: '0x0000000000000000000000000000000000000000', wrapped: '0x0bd7d308f8e1639fab988df18a8011f41eacad73' },
  sol: { symbol: 'SOL', decimals: 9, address: 'So11111111111111111111111111111111111111112' },
  bsc: { symbol: 'BNB', decimals: 18, address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', wrapped: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c' },
}

export const CHAIN_LABEL: Record<XChain, string> = { rh: 'Robinhood Chain', sol: 'Solana', bsc: 'BNB Chain' }

export const EXPLORER: Record<XChain, { tx: (h: string) => string; token: (a: string) => string }> = {
  rh: { tx: (h) => `https://robinhoodchain.blockscout.com/tx/${h}`, token: (a) => `https://robinhoodchain.blockscout.com/token/${a}` },
  sol: { tx: (h) => `https://solscan.io/tx/${h}`, token: (a) => `https://solscan.io/token/${a}` },
  bsc: { tx: (h) => `https://bscscan.com/tx/${h}`, token: (a) => `https://bscscan.com/token/${a}` },
}

/** Who must be approved to pull the input token for a BSC route, by quote source. */
export const BSC_SPENDER: Record<'engine' | 'kyberswap', `0x${string}`> = {
  engine: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
  kyberswap: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
}

export interface XToken {
  chain: XChain
  address: string
  symbol: string
  name: string
  decimals: number
  priceUsd?: number | null
}

export type XSource = 'engine' | 'jupiter' | 'kyberswap'

export interface XQuote {
  chain: XChain
  side: 'buy' | 'sell'
  token: string
  tokenIn: string
  tokenOut: string
  amountIn: string
  amountOut: string
  /** 1 when the whole size filled inside the liquidity we could see. */
  fillRatio: number
  /** Fee-excluded impact vs mid where we know it; aggregator-estimated otherwise. */
  priceImpactBps: number | null
  feeBps: number | null
  /** Native-per-token prices (human units), when known. */
  spotPrice: number | null
  execPrice: number | null
  route: { label: string; legs: string[]; source: XSource }
  /** Every leg simulated by our engine (vs a third-party quote). */
  exact: boolean
  /** One wallet transaction can sign this. */
  executable: boolean
  /** Buys: what selling the output right back would return, in native raw units. */
  instantExit?: string
  retention?: number
  gasUsd?: number | null
  /** The runner-up fill (engine vs aggregator), so the comparison is visible. */
  alt?: { source: XSource; amountOut: string; label: string }
  /** Adapter-specific payload for building the transaction. */
  exec: unknown
  quotedAt: number
}
