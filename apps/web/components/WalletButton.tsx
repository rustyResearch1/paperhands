'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { useMode } from '@/lib/mode'

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** In Practice mode the paper bankroll is the identity; in Real, the wallet. */
export default function WalletButton({ bankroll }: { bankroll: string }) {
  const { mode } = useMode()
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (mode === 'practice') {
    return (
      <span className="pill pill-up num" title="Paper bankroll">
        {bankroll} ETH
      </span>
    )
  }
  if (isConnected && address) {
    const wrongChain = chainId !== 4663
    return (
      <button className={`pill ${wrongChain ? 'pill-warn' : 'pill-pen'} num`} onClick={() => disconnect()} title="Disconnect">
        {wrongChain ? 'switch to Robinhood Chain · ' : ''}
        {short(address)}
      </button>
    )
  }
  const injectedConnector = connectors.find((c) => c.id === 'injected') ?? connectors[0]
  return (
    <button
      className="btn btn-sm btn-primary"
      disabled={!injectedConnector || isPending}
      onClick={() => injectedConnector && connect({ connector: injectedConnector })}
    >
      {isPending ? 'Connecting…' : 'Connect wallet'}
    </button>
  )
}
