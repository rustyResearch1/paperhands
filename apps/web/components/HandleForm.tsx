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
    <form onSubmit={save} className="flex flex-wrap items-center gap-2 text-[13.5px]">
      <label htmlFor="handle" className="label">
        Your handle
      </label>
      <input
        id="handle"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. diamondhands"
        maxLength={24}
        className="field field-sm w-48"
      />
      <button type="submit" disabled={saving || !value.trim()} className="btn btn-sm btn-ghost">
        {saving ? '…' : 'Save'}
      </button>
      {error && <span className="text-down">{error}</span>}
    </form>
  )
}
