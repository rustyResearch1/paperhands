'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AccountKey() {
  const router = useRouter()
  const [key, setKey] = useState<string | null>(null)
  const [restore, setRestore] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function reveal() {
    const r = await fetch('/api/account')
    const j = await r.json()
    if (j.key) setKey(j.key)
    else setMsg(j.error ?? 'could not load key')
  }

  async function copy() {
    if (!key) return
    try {
      await navigator.clipboard.writeText(key)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setMsg('copy failed — select and copy manually')
    }
  }

  async function doRestore(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const r = await fetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: restore }),
    })
    const j = await r.json()
    if (j.ok) {
      setMsg('account restored')
      router.refresh()
    } else setMsg(j.error)
  }

  return (
    <div className="slip p-4 mt-6 text-[12px]">
      <div className="flex items-center justify-between mb-2">
        <span className="rule-label">account key — your ledger IS this key</span>
        <span className="stamp text-stamp text-[9px]">keep it</span>
      </div>
      <p className="text-graphite mb-2">
        No signups here. Save this key and your ledger survives cleared cookies and moves between devices.
        Anyone holding it holds the account.
      </p>
      {key ? (
        <div className="flex gap-2 items-center mb-3">
          <code className="bg-paper-2 border border-grid px-2 py-1 break-all select-all">{key}</code>
          <button onClick={copy} className="border-2 border-ink px-3 py-1 font-bold uppercase tracking-wider bg-paper hover:bg-marker/40 shrink-0">
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
      ) : (
        <button onClick={reveal} className="border-2 border-ink px-3 py-1 font-bold uppercase tracking-wider bg-paper hover:bg-marker/40 mb-3">
          reveal my key
        </button>
      )}
      <form onSubmit={doRestore} className="flex gap-2 items-center">
        <input
          type="text"
          value={restore}
          onChange={(e) => setRestore(e.target.value)}
          placeholder="paste a key to restore that account here"
          className="flex-1 border-2 border-ink bg-paper px-2 py-1 focus:outline-2 focus:outline-pen"
        />
        <button type="submit" disabled={!restore.trim()} className="border-2 border-ink px-3 py-1 font-bold uppercase tracking-wider bg-pen text-paper disabled:opacity-40 shrink-0">
          restore
        </button>
      </form>
      {msg && <p className={`mt-2 ${msg === 'account restored' ? 'text-up' : 'text-down'}`}>{msg}</p>}
    </div>
  )
}
