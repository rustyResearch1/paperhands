'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatEth } from '@/lib/format'

export default function TailForm({ wallet, activeSize }: { wallet: string; activeSize: string | null }) {
  const router = useRouter()
  const [size, setSize] = useState('0.25')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(body: Record<string, unknown>) {
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/tail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const r = await res.json()
      if (!r.ok) setError(r.error)
      else router.refresh()
    } catch {
      setError('Request failed. Try again.')
    } finally {
      setPending(false)
    }
  }

  if (activeSize) {
    return (
      <div className="slip p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="rule-label">tailing</span>
          <span className="stamp text-up text-[9px]">active</span>
        </div>
        <p className="text-[12px] mb-3">
          Mirroring this wallet with <b>{formatEth(BigInt(activeSize))} ETH</b> per buy. Its sells exit your
          tailed positions.
        </p>
        <button
          onClick={() => post({ wallet, stop: true })}
          disabled={pending}
          className="w-full border-2 border-ink py-2 text-[12px] font-bold uppercase tracking-[0.14em] bg-down text-paper shadow-[3px_3px_0_rgba(28,33,39,0.25)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
        >
          {pending ? '…' : 'stop tailing'}
        </button>
        {error && <p className="text-down mt-2 text-[12px]">{error}</p>}
      </div>
    )
  }

  return (
    <div className="slip p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="rule-label">tail this wallet</span>
        <span className="stamp text-stamp text-[9px]">simulated</span>
      </div>
      <label htmlFor="tail-size" className="rule-label block mb-1">
        paper ETH per mirrored buy
      </label>
      <input
        id="tail-size"
        type="text"
        inputMode="decimal"
        value={size}
        onChange={(e) => setSize(e.target.value)}
        className="w-full border-2 border-ink bg-paper px-3 py-2 text-lg font-semibold focus:outline-2 focus:outline-pen"
      />
      <div className="flex gap-1 mt-2">
        {['0.1', '0.25', '0.5', '1'].map((p) => (
          <button key={p} onClick={() => setSize(p)} className="border border-grid px-2 py-0.5 text-[11px] hover:border-ink">
            {p}
          </button>
        ))}
      </div>
      <button
        onClick={() => post({ wallet, size })}
        disabled={pending || !(Number.parseFloat(size) > 0)}
        className="mt-4 w-full border-2 border-ink py-2.5 text-[13px] font-bold uppercase tracking-[0.14em] bg-pen text-paper shadow-[3px_3px_0_rgba(28,33,39,0.25)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
      >
        {pending ? 'wiring…' : 'start tailing'}
      </button>
      {error && <p className="text-down mt-2 text-[12px]">{error}</p>}
    </div>
  )
}
