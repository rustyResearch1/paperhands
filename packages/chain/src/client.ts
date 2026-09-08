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

/** True when a dedicated (non-public) endpoint is configured. */
export const hasDedicatedRpc = (url = process.env.PAPERHANDS_RPC) => Boolean(url && url !== RPC_URL)

export function makeClient(rpcUrl = process.env.PAPERHANDS_RPC ?? RPC_URL): PublicClient {
  const opts = { retryCount: 5, retryDelay: 400, timeout: 30_000 }
  if (rpcUrl === RPC_URL) {
    // The public RPC mishandles JSON-RPC batch arrays, so batching stays off.
    return createPublicClient({ chain: robinhoodChain, transport: http(rpcUrl, opts) })
  }
  // Dedicated endpoint: batch calls (one HTTP round trip for up to 100 reads —
  // a pool snapshot or a page of transaction lookups becomes a single request),
  // with the public RPC as a fallback. Never the other way round: the public
  // node rate-limits and serves only recent state.
  const transport = fallback([http(rpcUrl, { ...opts, batch: { batchSize: 100, wait: 12 } }), http(RPC_URL, { ...opts, retryCount: 2 })], { rank: false })
  return createPublicClient({ chain: robinhoodChain, transport })
}

export type ChainClient = PublicClient
