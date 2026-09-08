import { RPC_URL, robinhoodChain } from '@paperhands/chain'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'

/**
 * Non-custodial by construction: the only connector is the user's own
 * injected wallet (Robinhood Wallet, MetaMask, Rabby…). We never hold keys,
 * never sign — every real transaction is theirs to approve.
 */
export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected()],
  transports: {
    [robinhoodChain.id]: http(process.env.NEXT_PUBLIC_PAPERHANDS_RPC ?? RPC_URL),
  },
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
