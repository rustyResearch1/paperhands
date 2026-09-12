'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import Delta from '@/components/Delta'
import { formatDuration, formatQtyNum, formatUsd, shortAddr } from '@/lib/format'

export interface LaunchRowDto {
  token: string
  symbol: string
  name: string
  deployer: string
  nativeQuote: boolean
  quoteSymbol: string
  quoteUsd: number | null
  threshold: number
  ageSec: number
  buys: number
  sells: number
  traders: number
  quoteIn: number
  quoteOut: number
  inUsd: number | null
  reserve: number
  progressPct: number | null
  lastPrice: number | null
  mcapQuote: number | null
  mcapUsd: number | null
  trades5m: number
  buys5m: number
  graduatedTs: number | null
  pool: string | null
  status: 'live' | 'graduating' | 'graduated'
  deployerLaunches: number
  deployerGraduated: number
}

const FEEDS = [
  { id: 'new', label: 'New' },
  { id: 'trending', label: 'Trending · 5m' },
  { id: 'graduating', label: 'Graduating' },
  { id: 'graduated', label: 'Graduated' },
] as const

/**
 * The launchpad feed. Polls every 5 seconds — launches arrive about a dozen a
 * minute and a curve can fill in seconds, so the page has to move.
 */
export default function LaunchFeed({ ethUsd, initial }: { ethUsd: number | null; initial: (typeof FEEDS)[number]['id'] }) {
  const [feed, setFeed] = useState<(typeof FEEDS)[number]['id']>(initial)
  const q = useQuery({
    queryKey: ['launches', feed],
    queryFn: async () => (await fetch(`/api/launches?feed=${feed}&limit=50`)).json() as Promise<{ rows: LaunchRowDto[]; error?: string }>,
    refetchInterval: 5000,
  })
  const rows = q.data?.rows ?? []
  void ethUsd
  const money = (usd: number | null, amount: number, sym: string) => (usd !== null ? formatUsd(usd) : `${amount < 10 ? amount.toFixed(3) : amount.toFixed(1)} ${sym}`)
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FEEDS.map((f) => (
            <button key={f.id} className={`chip h-7 px-2.5 text-[12px] ${feed === f.id ? 'chip-active' : ''}`} onClick={() => setFeed(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-faint">{q.isFetching ? 'refreshing…' : `${rows.length} launches · live`}</span>
      </div>
      <div className="overflow-x-auto pt-2">
        <table className="tbl">
          <thead>
            <tr>
              <th className="txt">Token</th>
              <th className="txt hidden sm:table-cell">Quote</th>
              <th>Age</th>
              <th>Curve</th>
              <th className="hidden md:table-cell">5m</th>
              <th>Buys / sells</th>
              <th className="hidden lg:table-cell">Traders</th>
              <th>In</th>
              <th className="hidden lg:table-cell">Mcap</th>
              <th className="txt hidden md:table-cell">Deployer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.token}>
                <td className="txt">
                  <Link href={`/launch/${r.token}`} className="font-semibold hover:text-pen">
                    {r.symbol}
                  </Link>
                  <span className="ml-1.5 text-[11.5px] text-faint">{r.name.slice(0, 22)}</span>
                  {r.status === 'graduated' && <span className="ml-1.5 pill pill-up">graduated</span>}
                  {r.status === 'graduating' && <span className="ml-1.5 pill pill-warn">graduating</span>}
                </td>
                <td className="txt hidden sm:table-cell">
                  <span className={`pill ${r.nativeQuote ? '' : r.quoteSymbol === 'USDG' ? 'pill-pen' : 'pill-warn'}`} title={r.nativeQuote ? 'quoted in ETH' : `quoted in the ${r.quoteSymbol} token`}>
                    {r.quoteSymbol}
                  </span>
                </td>
                <td className="text-muted">{formatDuration(r.ageSec)}</td>
                <td>
                  {r.progressPct === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span className="num w-12 text-right">{r.progressPct.toFixed(0)}%</span>
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-sm sm:inline-block" style={{ background: 'var(--pen-soft)' }}>
                        <span className="block h-full" style={{ width: `${Math.max(2, r.progressPct)}%`, background: r.progressPct >= 80 ? 'var(--up)' : 'var(--pen)' }} />
                      </span>
                    </span>
                  )}
                </td>
                <td className="hidden md:table-cell">
                  {r.trades5m > 0 ? (
                    <span>
                      <span className="text-up">{r.buys5m}</span>
                      <span className="text-faint">/</span>
                      <span className="text-down">{r.trades5m - r.buys5m}</span>
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td>
                  <span className="text-up">{r.buys}</span>
                  <span className="text-faint">/</span>
                  <span className="text-down">{r.sells}</span>
                </td>
                <td className="hidden text-muted lg:table-cell">{r.traders}</td>
                <td>{money(r.inUsd, r.quoteIn, r.quoteSymbol)}</td>
                <td className="hidden lg:table-cell">{r.mcapQuote !== null ? money(r.mcapUsd, r.mcapQuote, r.quoteSymbol) : <span className="text-faint">—</span>}</td>
                <td className="txt num hidden md:table-cell">
                  <Link href={`/w/${r.deployer}`} className="hover:text-pen">
                    {shortAddr(r.deployer)}
                  </Link>
                  <span className={`ml-1.5 text-[11px] ${r.deployerLaunches >= 5 && r.deployerGraduated === 0 ? 'text-down' : 'text-faint'}`} title="launches by this deployer · graduated">
                    {r.deployerLaunches}L · {r.deployerGraduated}G
                  </span>
                </td>
              </tr>
            ))}
            {q.data && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-muted">
                  Nothing here yet — the launchpad indexer fills this in as the chain moves.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function LaunchStatus({ status }: { status: LaunchRowDto['status'] }) {
  if (status === 'graduated') return <span className="pill pill-up">graduated</span>
  if (status === 'graduating') return <span className="pill pill-warn">graduating</span>
  return <span className="pill pill-pen">on the curve</span>
}

export { Delta, formatQtyNum }
