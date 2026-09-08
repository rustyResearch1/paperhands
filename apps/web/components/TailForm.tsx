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
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="label">Tailing</span>
          <span className="pill pill-up">active</span>
        </div>
        <p className="mb-4 text-[13.5px]">
          Mirroring this wallet with <b>{formatEth(BigInt(activeSize))} ETH</b> per buy. Its sells exit your tailed positions.
        </p>
        <button onClick={() => post({ wallet, stop: true })} disabled={pending} className="btn btn-danger w-full">
          {pending ? '…' : 'Stop tailing'}
        </button>
        {error && <p className="mt-2 text-[13px] text-down">{error}</p>}
      </div>
    )
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Tail this wallet</span>
        <span className="pill">practice</span>
      </div>
      <label htmlFor="tail-size" className="label mb-1.5 block">
        Paper ETH per mirrored buy
      </label>
      <input id="tail-size" type="text" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} className="field num" />
      <div className="mt-2 flex gap-1.5">
        {['0.1', '0.25', '0.5', '1'].map((p) => (
          <button key={p} onClick={() => setSize(p)} className={`chip h-8 px-3 ${size === p ? 'chip-active' : ''}`}>
            {p}
          </button>
        ))}
      </div>
      <button onClick={() => post({ wallet, size })} disabled={pending || !(Number.parseFloat(size) > 0)} className="btn btn-pen mt-4 w-full">
        {pending ? 'Wiring…' : 'Start tailing'}
      </button>
      {error && <p className="mt-2 text-[13px] text-down">{error}</p>}
    </div>
  )
}
