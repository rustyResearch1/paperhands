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

export function makeClient(rpcUrl = RPC_URL): PublicClient {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(rpcUrl, { batch: true }),
  })
}

export type ChainClient = PublicClient
