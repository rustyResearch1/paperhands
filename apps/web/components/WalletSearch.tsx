'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Paste any wallet → its explorer page (Robinhood Chain or BNB Chain). */
export default function WalletSearch({ chain = 'rh', placeholder }: { chain?: 'rh' | 'bsc'; placeholder?: string }) {
  const router = useRouter()
  const [v, setV] = useState('')
  const [bad, setBad] = useState(false)
  function go() {
    const a = v.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      setBad(true)
      return
    }
    router.push(chain === 'bsc' ? `/x/bsc/w/${a.toLowerCase()}` : `/w/${a.toLowerCase()}`)
  }
  return (
    <div className="flex w-full items-center gap-2 md:w-96">
      <input
        className={`field field-sm num ${bad ? 'ring-2 ring-[var(--down)]' : ''}`}
        placeholder={placeholder ?? 'Paste a wallet address…'}
        value={v}
        onChange={(e) => {
          setV(e.target.value)
          setBad(false)
        }}
        onKeyDown={(e) => e.key === 'Enter' && go()}
      />
      <button className="btn btn-sm btn-ghost" onClick={go}>
        Open
      </button>
    </div>
  )
}
