import { createPublicClient, defineChain, fallback, http, type PublicClient } from 'viem'
import { CHAIN_ID, EXPLORER_URL, RPC_URL } from './addresses.js'

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: EXPLORER_URL },
  },
})

export function makeClient(rpcUrl = process.env.PAPERHANDS_RPC ?? RPC_URL): PublicClient {
  // The public RPC mishandles JSON-RPC batch arrays, so batching stays off.
  const opts = { retryCount: 5, retryDelay: 400, timeout: 30_000 }
  // A dedicated endpoint first, the public one as a fallback (and vice versa
  // never: the public RPC rate-limits and serves only recent state).
  const transport = rpcUrl !== RPC_URL ? fallback([http(rpcUrl, opts), http(RPC_URL, { ...opts, retryCount: 2 })], { rank: false }) : http(rpcUrl, opts)
  return createPublicClient({ chain: robinhoodChain, transport })
}

export type ChainClient = PublicClient
