'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { formatUsd, timeAgo } from '@/lib/format'

interface Backing {
  id: number
  wallet: string
  ethIn: string
  openedTs: number
  closedTs: number | null
  ethOut: string | null
  markEth: number
  pnlEth: number
  holdings: { symbol: string }[]
}

const eth = (n: number, d = 3) => n.toLocaleString('en-US', { maximumFractionDigits: d })

/** Paper baskets held on the practice bankroll, valued at last-trade marks. */
export default function BackedBaskets({ ethUsd }: { ethUsd: number | null }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['baskets', 'mine'], queryFn: async () => (await fetch('/api/baskets?mine=1')).json() as Promise<{ backings: Backing[] }>, refetchInterval: 60_000 })
  const unwind = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch('/api/baskets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'unwind', id }) })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? 'request failed')
      return j
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['baskets', 'mine'] }),
  })
  const all = q.data?.backings ?? []
  const open = all.filter((b) => !b.closedTs)
  const closed = all.filter((b) => b.closedTs)
  if (!q.data || all.length === 0) return null
  const openMark = open.reduce((a, b) => a + b.markEth, 0)
  const openPnl = open.reduce((a, b) => a + b.pnlEth, 0)
  const closedPnl = closed.reduce((a, b) => a + b.pnlEth, 0)
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <span className="label">Backed baskets</span>
        <span className="num text-[12px] text-muted">
          {open.length} open · {eth(openMark, 3)} ETH{ethUsd ? ` (${formatUsd(openMark * ethUsd)})` : ''} ·{' '}
          <span className={openPnl >= 0 ? 'text-up' : 'text-down'}>
            {openPnl >= 0 ? '+' : ''}
            {eth(openPnl, 3)} ETH open
          </span>
          {closed.length > 0 && (
            <>
              {' '}
              · <span className={closedPnl >= 0 ? 'text-up' : 'text-down'}>{closedPnl >= 0 ? '+' : ''}{eth(closedPnl, 3)} ETH realized</span> on {closed.length} unwound
            </>
          )}
        </span>
      </div>
      <div className="overflow-x-auto pt-2">
        <table className="tbl">
          <thead>
            <tr>
              <th>Wallet</th>
              <th className="hidden md:table-cell">Tokens</th>
              <th>Backed</th>
              <th>Now</th>
              <th>P&amp;L</th>
              <th className="hidden md:table-cell">Opened</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {open.map((b) => (
              <tr key={b.id}>
                <td>
                  <Link href={`/w/${b.wallet}/basket`} className="num font-semibold hover:text-pen">
                    {b.wallet.slice(0, 6)}…{b.wallet.slice(-4)}
                  </Link>
                </td>
                <td className="hidden text-muted md:table-cell">{b.holdings.map((h) => h.symbol).slice(0, 4).join(' · ')}{b.holdings.length > 4 ? ` +${b.holdings.length - 4}` : ''}</td>
                <td>{eth(Number(BigInt(b.ethIn)) / 1e18)} ETH</td>
                <td>{eth(b.markEth)} ETH</td>
                <td className={b.pnlEth >= 0 ? 'text-up' : 'text-down'}>
                  {b.pnlEth >= 0 ? '+' : ''}
                  {eth(b.pnlEth)} ETH
                </td>
                <td className="hidden text-muted md:table-cell">{timeAgo(b.openedTs)} ago</td>
                <td>
                  <button className="btn btn-ghost btn-sm" disabled={unwind.isPending} onClick={() => unwind.mutate(b.id)}>
                    Unwind
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unwind.isError && <div className="px-4 pb-3 text-[12.5px] text-down">{(unwind.error as Error).message}</div>}
    </div>
  )
}
