'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const CHAINS = [
  { id: 'rh', label: 'RH', href: '/', title: 'Robinhood Chain' },
  { id: 'sol', label: 'SOL', href: '/x/sol', title: 'Solana' },
  { id: 'bsc', label: 'BSC', href: '/x/bsc', title: 'BNB Chain' },
] as const

/** Which chain the current page belongs to: /x/<chain>/… or Robinhood Chain by default. */
export function chainFromPath(path: string): 'rh' | 'sol' | 'bsc' {
  const m = path.match(/^\/x\/(sol|bsc)(\/|$)/)
  return (m?.[1] as 'sol' | 'bsc' | undefined) ?? 'rh'
}

export default function ChainSwitch() {
  const path = usePathname()
  const active = chainFromPath(path ?? '/')
  return (
    <div className="seg" role="tablist" aria-label="Chain">
      {CHAINS.map((c) => (
        <Link key={c.id} href={c.href} role="tab" aria-selected={active === c.id} title={c.title} className="px-3">
          {c.label}
        </Link>
      ))}
    </div>
  )
}
