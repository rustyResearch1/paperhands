'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** No signups: the account IS a key. Reveal it to keep it; paste one to restore. */
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
    else setMsg(j.error ?? 'Could not load key')
  }

  async function copy() {
    if (!key) return
    try {
      await navigator.clipboard.writeText(key)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setMsg('Copy failed — select and copy manually')
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
      setMsg('Account restored')
      router.refresh()
    } else setMsg(j.error)
  }

  return (
    <div className="card p-5 text-[13.5px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Account key</span>
        <span className="pill pill-warn">keep it safe</span>
      </div>
      <p className="mb-3 text-muted">
        No signups. Your practice ledger is this key — save it and it survives cleared cookies and moves between devices. Anyone holding it holds
        the account.
      </p>
      {key ? (
        <div className="mb-3 flex items-center gap-2">
          <code className="num min-w-0 flex-1 select-all break-all rounded-lg bg-bg-3 px-3 py-2 text-[12px]">{key}</code>
          <button onClick={copy} className="btn btn-sm btn-ghost shrink-0">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <button onClick={reveal} className="btn btn-sm btn-ghost mb-3">
          Reveal my key
        </button>
      )}
      <form onSubmit={doRestore} className="flex items-center gap-2">
        <input
          type="text"
          value={restore}
          onChange={(e) => setRestore(e.target.value)}
          placeholder="Paste a key to restore that account"
          className="field field-sm num flex-1 text-[13px] font-normal"
        />
        <button type="submit" disabled={!restore.trim()} className="btn btn-sm btn-pen shrink-0">
          Restore
        </button>
      </form>
      {msg && <p className={`mt-2 ${msg === 'Account restored' ? 'text-up' : 'text-down'}`}>{msg}</p>}
    </div>
  )
}
