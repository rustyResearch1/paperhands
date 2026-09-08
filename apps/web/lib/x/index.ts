import { bscQuote, bscToken } from './bsc'
import { coalesce, quoteSemaphore } from './limits'
import { rhQuote, rhToken } from './rh'
import { solQuote, solToken } from './sol'
import { NATIVE, X_CHAINS, type XChain, type XQuote, type XToken } from './types'

export * from './types'

export function isXChain(v: string | null | undefined): v is XChain {
  return X_CHAINS.includes(v as XChain)
}

export function validTokenAddress(chain: XChain, address: string): boolean {
  if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
  return /^0x[0-9a-fA-F]{40}$/.test(address)
}

/**
 * Best fill for `amountIn` of native (buys) or token (sells) on one chain.
 * Same honest shape everywhere: fill, impact, route, sold-right-back.
 */
export async function xquote(chain: XChain, side: 'buy' | 'sell', token: string, amountIn: bigint): Promise<XQuote> {
  if (amountIn <= 0n) throw new Error('amount must be positive')
  const key = `${chain}:${side}:${token.toLowerCase()}:${amountIn}`
  // Same quote requested twice at once → computed once; RPC-heavy chains take a slot.
  return coalesce(key, () => {
    switch (chain) {
      case 'rh':
        return quoteSemaphore.run(() => rhQuote(side, token.toLowerCase(), amountIn))
      case 'sol':
        return solQuote(side, token, amountIn)
      case 'bsc':
        return quoteSemaphore.run(() => bscQuote(side, token.toLowerCase(), amountIn))
    }
  })
}

export async function xtoken(chain: XChain, address: string): Promise<XToken | null> {
  switch (chain) {
    case 'rh':
      return rhToken(address)
    case 'sol':
      return solToken(address).catch(() => null)
    case 'bsc':
      return bscToken(address).catch(() => null)
  }
}

/** Parse a human native amount ("0.25") into raw units for the chain. */
export function nativeToRaw(chain: XChain, human: string | number): bigint {
  const v = Number(human)
  if (!Number.isFinite(v) || v <= 0) return 0n
  const d = NATIVE[chain].decimals
  return BigInt(Math.round(v * 1e6)) * 10n ** BigInt(d - 6)
}
