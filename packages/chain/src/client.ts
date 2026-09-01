import { createPublicClient, defineChain, http, type PublicClient } from 'viem'
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
  return createPublicClient({
    chain: robinhoodChain,
    // The public RPC mishandles JSON-RPC batch arrays, so batching stays off.
    transport: http(rpcUrl, {
      retryCount: 5,
      retryDelay: 400,
      timeout: 30_000,
    }),
  })
}

export type ChainClient = PublicClient
