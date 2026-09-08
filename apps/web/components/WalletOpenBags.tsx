'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { formatQty, formatUsd } from '@/lib/format'

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
}

function useBagValues(bags: OpenBag[]) {
  // The six biggest bags: each is a full best-route quote against live pools.
  const top = bags.filter((b) => BigInt(b.openQtyRaw) > 0n).sort((a, b) => b.markEth - a.markEth).slice(0, 6)
  return useQuery({
    queryKey: ['bags', top.map((b) => `${b.token}:${b.openQtyRaw}`).join('|')],
    queryFn: async () => {
      const r = (await (
        await fetch('/api/v1/xvalue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: 'rh', holdings: top.map((b) => ({ token: b.token, amount: b.openQtyRaw })) }) })
      ).json()) as { rows?: ValueRow[] }
      const map = new Map<string, number | null>()
      for (const row of r.rows ?? []) map.set(row.token.toLowerCase(), row.realizable && (row.fillRatio ?? 1) >= 0.999 ? Number(BigInt(row.realizable)) / 1e18 : null)
      return { map, top }
    },
    enabled: top.length > 0,
    staleTime: 30_000,
  })
}

/** Headline: unrealized P&L across the open bags, at what the pool would pay. */
export function OpenBagsKpi({ bags, ethUsd }: { bags: OpenBag[]; ethUsd: number | null }) {
  const q = useBagValues(bags)
  if (bags.every((b) => BigInt(b.openQtyRaw) === 0n)) return <Kpi label="Unrealized · pool would pay" value="—" sub="no open bags" />
  if (!q.data) return <Kpi label="Unrealized · pool would pay" value="…" sub="quoting exits" />
  let realizable = 0
  let cost = 0
  let n = 0
  for (const b of q.data.top) {
    const v = q.data.map.get(b.token.toLowerCase())
    if (v === null || v === undefined) continue
    realizable += v
    cost += b.openCost
    n++
  }
  const pnl = realizable - cost
  return (
    <Kpi
      label="Unrealized · pool would pay"
      value={n ? `${pnl >= 0 ? '+' : ''}${pnl.toLocaleString('en-US', { maximumFractionDigits: 3 })}` : '—'}
      sub={n ? `ETH${ethUsd ? ` · ${formatUsd(pnl * ethUsd)}` : ''} · ${n} bag${n === 1 ? '' : 's'} quoted` : 'no route for the open bags'}
      tone={n ? (pnl >= 0 ? 'up' : 'down') : undefined}
    />
  )
}

/** The open bags, each at what selling the whole thing would return right now. */
export function OpenBagsTable({ bags, ethUsd }: { bags: OpenBag[]; ethUsd: number | null }) {
  const q = useBagValues(bags)
  const open = bags.filter((b) => BigInt(b.openQtyRaw) > 0n).sort((a, b) => b.markEth - a.markEth)
  if (open.length === 0) return null
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <span className="label">Open bags · what the pool would pay</span>
        <span className="text-[12px] text-faint">full-size exit through the best route, right now</span>
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
              const v = q.data?.map.get(b.token.toLowerCase())
              const pnl = v === null || v === undefined ? null : v - b.openCost
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
                    {q.data ? (
                      v === null || v === undefined ? (
                        <span className="text-faint">{q.data.top.some((t) => t.token === b.token) ? 'no full exit' : 'not quoted'}</span>
                      ) : (
                        <span className="hilite">{v.toFixed(4)} ETH{ethUsd ? ` · ${formatUsd(v * ethUsd)}` : ''}</span>
                      )
                    ) : (
                      '…'
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

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="card-flat p-4">
      <div className="label">{label}</div>
      <div className={`num mt-1 text-[18px] font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-faint">{sub}</div>}
    </div>
  )
}
