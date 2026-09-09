'use client'

import { useQueries } from '@tanstack/react-query'
import Link from 'next/link'
import { formatQty, formatUsd } from '@/lib/format'
import Kpi from '@/components/Kpi'

export interface OpenBag {
  token: string
  pool: string
  symbol: string
  decimals: number
  openQtyRaw: string
  openCost: number
  markEth: number
}

interface ValueRow {
  token: string
  realizable: string | null
  fillRatio?: number
  error?: string
}

/**
 * The bags' exit quotes in ONE request. The endpoint takes fifteen holdings per
 * call but this asked for one bag per call, so a single wallet page spent six of
 * the twenty requests a visitor gets per minute — three page views and you were
 * rate-limited.
 */
function useBagValues(bags: OpenBag[]) {
  const top = bags.filter((b) => BigInt(b.openQtyRaw) > 0n).sort((a, b) => b.markEth - a.markEth).slice(0, 6)
  const key = top.map((b) => `${b.token}:${b.openQtyRaw}`).join(',')
  const [result] = useQueries({
    queries: [
      {
        queryKey: ['bagv', key],
        enabled: top.length > 0,
        queryFn: async (): Promise<Record<string, number | null>> => {
          const r = (await (
            await fetch('/api/v1/xvalue', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ chain: 'rh', holdings: top.map((b) => ({ token: b.token, amount: b.openQtyRaw })) }),
            })
          ).json()) as { rows?: ValueRow[] }
          const out: Record<string, number | null> = {}
          for (const row of r.rows ?? []) {
            out[row.token.toLowerCase()] = row.realizable && (row.fillRatio ?? 1) >= 0.999 ? Number(BigInt(row.realizable)) / 1e18 : null
          }
          return out
        },
        staleTime: 60_000,
        retry: 1,
      },
    ],
  })
  const loading = Boolean(result?.isLoading) && top.length > 0
  const map = new Map<string, { value: number | null; loading: boolean }>()
  for (const b of top) map.set(b.token.toLowerCase(), { value: result?.data?.[b.token.toLowerCase()] ?? null, loading })
  return { top, map, pending: loading ? top.length : 0 }
}

/** Headline: unrealized P&L across the open bags, at what the pool would pay. */
export function OpenBagsKpi({ bags, ethUsd }: { bags: OpenBag[]; ethUsd: number | null }) {
  const { top, map, pending } = useBagValues(bags)
  if (top.length === 0) return <Kpi label="Unrealized · pool would pay" value="—" sub="no open bags" />
  let realizable = 0
  let cost = 0
  let n = 0
  for (const b of top) {
    const v = map.get(b.token.toLowerCase())?.value
    if (v === null || v === undefined) continue
    realizable += v
    cost += b.openCost
    n++
  }
  const pnl = realizable - cost
  if (n === 0) return <Kpi label="Unrealized · pool would pay" value={pending ? '…' : '—'} sub={pending ? `quoting ${pending} exit${pending === 1 ? '' : 's'}` : 'no full-size route'} />
  return (
    <Kpi
      label="Unrealized · pool would pay"
      value={`${pnl >= 0 ? '+' : ''}${pnl.toLocaleString('en-US', { maximumFractionDigits: 3 })}`}
      sub={`ETH${ethUsd ? ` · ${formatUsd(pnl * ethUsd)}` : ''} · ${n} of ${top.length} bags${pending ? ` · ${pending} quoting` : ''}`}
      tone={pnl >= 0 ? 'up' : 'down'}
    />
  )
}

/** The open bags, each at what selling the whole thing would return right now. */
export function OpenBagsTable({ bags, ethUsd }: { bags: OpenBag[]; ethUsd: number | null }) {
  const { top, map } = useBagValues(bags)
  const open = bags.filter((b) => BigInt(b.openQtyRaw) > 0n).sort((a, b) => b.markEth - a.markEth)
  if (open.length === 0) return null
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <span className="label">Open bags · what the pool would pay</span>
        <span className="text-[12px] text-faint">full-size exit through the best route, right now · {top.length} biggest quoted</span>
      </div>
      <div className="overflow-x-auto px-2 pb-2 pt-2">
        <table className="tbl">
          <thead>
            <tr>
              <th>Token</th>
              <th>Qty</th>
              <th>Cost</th>
              <th className="hidden md:table-cell">Marked</th>
              <th>Pool would pay</th>
              <th>Unrealized</th>
            </tr>
          </thead>
          <tbody>
            {open.map((b) => {
              const cell = map.get(b.token.toLowerCase())
              const v = cell?.value ?? null
              const pnl = v === null ? null : v - b.openCost
              return (
                <tr key={b.token}>
                  <td className="font-semibold">
                    <Link href={`/t/${b.pool}`} className="hover:text-pen">
                      {b.symbol}
                    </Link>
                  </td>
                  <td className="text-muted">{formatQty(BigInt(b.openQtyRaw), b.decimals)}</td>
                  <td className="text-muted">{b.openCost.toFixed(4)} ETH</td>
                  <td className="hidden text-muted line-through md:table-cell">{b.markEth > 0 ? `${b.markEth.toFixed(4)} ETH` : '—'}</td>
                  <td className="font-semibold">
                    {!cell ? (
                      <span className="text-faint">not quoted</span>
                    ) : cell.loading ? (
                      <span className="text-faint">quoting…</span>
                    ) : v === null ? (
                      <span className="text-faint">no full exit</span>
                    ) : (
                      <span className="hilite">
                        {v.toFixed(4)} ETH{ethUsd ? ` · ${formatUsd(v * ethUsd)}` : ''}
                      </span>
                    )}
                  </td>
                  <td className={pnl === null ? 'text-faint' : pnl >= 0 ? 'text-up font-semibold' : 'text-down font-semibold'}>{pnl === null ? '—' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} ETH`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

