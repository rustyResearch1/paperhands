'use client'

import { VersionedTransaction } from '@solana/web3.js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Minimal non-custodial Solana wallet bridge over the injected provider
 * (Phantom, Solflare, Backpack — all expose the same `window.solana`
 * surface). We ask the wallet to sign and send; we never see a key.
 */
interface Provider {
  isPhantom?: boolean
  publicKey?: { toBase58(): string } | null
  isConnected?: boolean
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>
  disconnect(): Promise<void>
  signAndSendTransaction(tx: VersionedTransaction, opts?: { skipPreflight?: boolean; maxRetries?: number }): Promise<{ signature: string }>
  on?(event: 'connect' | 'disconnect' | 'accountChanged', cb: (arg?: unknown) => void): void
  off?(event: 'connect' | 'disconnect' | 'accountChanged', cb: (arg?: unknown) => void): void
}

function getProvider(): Provider | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { phantom?: { solana?: Provider }; solana?: Provider; solflare?: Provider; backpack?: Provider }
  return w.phantom?.solana ?? w.solana ?? w.solflare ?? w.backpack ?? null
}

interface Ctx {
  publicKey: string | null
  available: boolean
  walletName: string
  connecting: boolean
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Signs and broadcasts a base64 VersionedTransaction; returns the signature. */
  signAndSend(base64Tx: string): Promise<string>
}

const SolanaCtx = createContext<Ctx | null>(null)

export function SolanaProvider({ children }: { children: React.ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [available, setAvailable] = useState(false)
  const [walletName, setWalletName] = useState('Solana wallet')
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    const p = getProvider()
    setAvailable(Boolean(p))
    if (!p) return
    setWalletName(p.isPhantom ? 'Phantom' : 'Solana wallet')
    // Silent reconnect for wallets that already trust this site.
    p.connect({ onlyIfTrusted: true })
      .then((r) => setPublicKey(r.publicKey.toBase58()))
      .catch(() => {})
    const onAccount = (arg?: unknown) => {
      const pk = (arg as { toBase58?: () => string } | null)?.toBase58?.() ?? p.publicKey?.toBase58() ?? null
      setPublicKey(pk)
    }
    const onDisconnect = () => setPublicKey(null)
    p.on?.('accountChanged', onAccount)
    p.on?.('disconnect', onDisconnect)
    return () => {
      p.off?.('accountChanged', onAccount)
      p.off?.('disconnect', onDisconnect)
    }
  }, [])

  const connect = useCallback(async () => {
    const p = getProvider()
    if (!p) throw new Error('No Solana wallet found — install Phantom')
    setConnecting(true)
    try {
      const r = await p.connect()
      setPublicKey(r.publicKey.toBase58())
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    await getProvider()?.disconnect()
    setPublicKey(null)
  }, [])

  const signAndSend = useCallback(async (base64Tx: string) => {
    const p = getProvider()
    if (!p) throw new Error('No Solana wallet found')
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0)))
    const { signature } = await p.signAndSendTransaction(tx, { maxRetries: 3 })
    return signature
  }, [])

  const value = useMemo<Ctx>(() => ({ publicKey, available, walletName, connecting, connect, disconnect, signAndSend }), [publicKey, available, walletName, connecting, connect, disconnect, signAndSend])
  return <SolanaCtx.Provider value={value}>{children}</SolanaCtx.Provider>
}

export function useSolana(): Ctx {
  const c = useContext(SolanaCtx)
  if (!c) throw new Error('useSolana outside SolanaProvider')
  return c
}

/** Poll a signature until it lands (or the RPC gives up). Public RPC; read-only. */
export async function waitForSignature(signature: string, timeoutMs = 60_000): Promise<'confirmed' | 'failed' | 'timeout'> {
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[signature], { searchTransactionHistory: true }] }),
    })
    const j = (await res.json()) as { result?: { value: ({ confirmationStatus: string; err: unknown } | null)[] } }
    const s = j.result?.value[0]
    if (s?.err) return 'failed'
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return 'confirmed'
    await new Promise((r) => setTimeout(r, 1500))
  }
  return 'timeout'
}
