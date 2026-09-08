'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface Hit {
  address: string
  symbol: string
  name: string
  priceUsd?: number | null
}

/** Token search: symbol/name/mint on Solana (Jupiter), address on BNB Chain. */
export default function XSearch({ chain }: { chain: 'sol' | 'bsc' }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    if (chain === 'bsc') {
      if (/^0x[0-9a-fA-F]{40}$/.test(term)) setHits([{ address: term.toLowerCase(), symbol: 'open', name: term }])
      else setHits([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const r = (await (await fetch(`/api/v1/xsearch?chain=sol&q=${encodeURIComponent(term)}`)).json()) as { results?: Hit[] }
        setHits(r.results ?? [])
        setOpen(true)
      } catch {
        setHits([])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q, chain])

  return (
    <div className="relative w-full md:w-80">
      <input
        className="field field-sm"
        placeholder={chain === 'sol' ? 'Search token or paste mint…' : 'Paste a BNB Chain token address…'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) router.push(`/x/${chain}/${hits[0].address}`)
        }}
      />
      {open && hits.length > 0 && (
        <ul className="card absolute z-30 mt-1 w-full overflow-hidden p-1">
          {hits.slice(0, 8).map((h) => (
            <li key={h.address}>
              <button className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-bg-2" onMouseDown={() => router.push(`/x/${chain}/${h.address}`)}>
                <span>
                  <span className="font-semibold">{h.symbol}</span> <span className="text-muted">{h.name.slice(0, 28)}</span>
                </span>
                <span className="num text-[12px] text-faint">{h.priceUsd ? `$${h.priceUsd < 0.01 ? h.priceUsd.toPrecision(3) : h.priceUsd.toFixed(2)}` : h.address.slice(0, 6) + '…'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
