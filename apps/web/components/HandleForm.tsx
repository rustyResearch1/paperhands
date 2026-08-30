'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HandleForm({ current }: { current: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(current ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/handle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: value }),
      })
      const r = await res.json()
      if (!r.ok) setError(r.error)
      else router.refresh()
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="mb-5 flex items-center gap-2 text-[12px]">
      <label htmlFor="handle" className="rule-label">
        sign the wall as
      </label>
      <input
        id="handle"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="your handle"
        maxLength={24}
        className="border-2 border-ink bg-paper px-2 py-1 w-44 focus:outline-2 focus:outline-pen"
      />
      <button type="submit" disabled={saving || !value.trim()} className="border-2 border-ink px-3 py-1 font-bold uppercase tracking-wider bg-paper hover:bg-marker/40 disabled:opacity-40">
        {saving ? '…' : 'sign'}
      </button>
      {error && <span className="text-down">{error}</span>}
    </form>
  )
}
