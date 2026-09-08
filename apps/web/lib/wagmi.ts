import { RPC_URL, robinhoodChain } from '@paperhands/chain'
import { bsc } from 'viem/chains'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'

/**
 * Non-custodial by construction: the only connector is the user's own
 * injected wallet (Robinhood Wallet, MetaMask, Rabby…). We never hold keys,
 * never sign — every real transaction is theirs to approve. Robinhood Chain
 * and BNB Chain share the same EVM wallet; Solana has its own provider.
 */
export const wagmiConfig = createConfig({
  chains: [robinhoodChain, bsc],
  connectors: [injected()],
  transports: {
    [robinhoodChain.id]: http(process.env.NEXT_PUBLIC_PAPERHANDS_RPC ?? RPC_URL),
    [bsc.id]: http(process.env.NEXT_PUBLIC_BSC_RPC ?? 'https://bsc-dataseed.binance.org'),
  },
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
