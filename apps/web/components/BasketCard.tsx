'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import IndexLine from '@/components/IndexLine'
import { formatUsd, timeAgo } from '@/lib/format'
import { useMode } from '@/lib/mode'

interface Holding {
  token: string
  pool: string
  symbol: string
  qty: number
  close: number
  markEth: number
  weight: number
  change7dPct: number | null
}
interface Backing {
  id: number
  wallet: string
  ethIn: string
  openedTs: number
  closedTs: number | null
  markEth: number
  pnlEth: number
  holdings: { symbol: string }[]
}
interface Data {
  basket: { address: string; rank: number | null; markEth: number; holdings: Holding[]; excluded: number; asOf: number }
  series: { points: { ts: number; index: number; valueEth: number }[]; returnPct: number | null; days: number }
  mine: Backing[]
  balance: string
  error?: string
}

const eth = (n: number, d = 3) => n.toLocaleString('en-US', { maximumFractionDigits: d })
const qty = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(n < 10 ? 2 : 0))
const pct = (n: number | null) => (n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`)

/**
 * A wallet as a basket: what it holds by weight, what holding that basket
 * would have done, and paper backing on the practice bankroll.
 */
export default function BasketCard({ address, ethUsd }: { address: string; ethUsd: number | null }) {
  const { mode } = useMode()
  const qc = useQueryClient()
  const [days, setDays] = useState(7)
  const [amount, setAmount] = useState('1')
  const q = useQuery({
    queryKey: ['basket', address, days],
    queryFn: async () => (await fetch(`/api/baskets?wallet=${address}&days=${days}`)).json() as Promise<Data>,
    refetchInterval: 60_000,
  })
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/baskets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = (await r.json()) as { error?: string }
    if (!r.ok) throw new Error(j.error ?? 'request failed')
    return j
  }
  const back = useMutation({ mutationFn: () => post({ action: 'back', wallet: address, eth: amount }), onSuccess: () => qc.invalidateQueries({ queryKey: ['basket', address] }) })
  const unwind = useMutation({ mutationFn: (id: number) => post({ action: 'unwind', id }), onSuccess: () => qc.invalidateQueries({ queryKey: ['basket', address] }) })

  if (q.isLoading) return <div className="card p-5 text-[13px] text-muted">Reading the wallet's bags…</div>
  const d = q.data
  if (!d || d.error) return <div className="card p-5 text-[13px] text-down">{d?.error ?? 'Could not load this basket.'}</div>
  const b = d.basket
  const usd = (e: number) => (ethUsd ? ` · ${formatUsd(e * ethUsd)}` : '')
  const balanceEth = Number(BigInt(d.balance)) / 1e18
  const open = d.mine.filter((m) => !m.closedTs)

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
            <span className="label">Basket · {b.holdings.length} holdings</span>
            <span className="num text-[12px] text-muted">
              marked {eth(b.markEth, 2)} ETH{usd(b.markEth)}
              {b.excluded > 0 ? ` · ${b.excluded} dust bags left out` : ''}
            </span>
          </div>
          <div className="overflow-x-auto pt-2">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Weight</th>
                  <th className="hidden md:table-cell">Qty</th>
                  <th>Marked</th>
                  <th>7d</th>
                </tr>
              </thead>
              <tbody>
                {b.holdings.map((h) => (
                  <tr key={h.token}>
                    <td>
                      <Link href={`/t/${h.pool}`} className="font-semibold hover:text-pen">
                        {h.symbol}
                      </Link>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="num w-14 text-right">{(h.weight * 100).toFixed(1)}%</span>
                        <span className="hidden h-2 w-24 overflow-hidden rounded-sm sm:block" style={{ background: 'var(--pen-soft)' }}>
                          <span className="block h-full" style={{ width: `${Math.max(2, h.weight * 100)}%`, background: 'var(--pen)' }} />
                        </span>
                      </div>
                    </td>
                    <td className="hidden text-muted md:table-cell">{qty(h.qty)}</td>
                    <td>{eth(h.markEth)} ETH</td>
                    <td className={h.change7dPct === null ? 'text-faint' : h.change7dPct >= 0 ? 'text-up' : 'text-down'}>{pct(h.change7dPct)}</td>
                  </tr>
                ))}
                {b.holdings.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-muted">
                      No marked open bags. A basket needs holdings with a recent price.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="label">Had you backed this basket</span>
            <div className="flex items-center gap-1.5">
              {[7, 14, 30].map((n) => (
                <button key={n} className={`chip h-7 px-2.5 text-[12px] ${days === n ? 'chip-active' : ''}`} onClick={() => setDays(n)}>
                  {n}d
                </button>
              ))}
              <span className={`pill ml-2 ${d.series.returnPct === null ? '' : d.series.returnPct >= 0 ? 'pill-up' : 'pill-down'}`}>{pct(d.series.returnPct)}</span>
            </div>
          </div>
          <IndexLine points={d.series.points} label={`Basket index, ${days} days`} />
          <p className="mt-2 text-[11.5px] text-faint">
            The basket as it stands today, priced back {days} days at hourly closes from our ledger, indexed to 100. Holdings younger than the window carry their first
            known price until it exists. Marks are chart prices, not fills. The dotted line is holding ETH instead.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card p-4">
          <div className="label">Back this wallet</div>
          {mode === 'real' ? (
            <p className="mt-2 text-[13px] text-muted">
              Paper only for now. The on-chain version, a basket token whose pool fees buy the wallet's bags, is the next stage. Switch to Practice to hold this basket
              on your paper bankroll.
            </p>
          ) : (
            <>
              <p className="mt-1 text-[12.5px] text-muted">
                Hold this basket at today's weights on your practice bankroll. You keep the quantities; the wallet's later trades don't move your position.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input className="input num w-28" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="ETH to back with" />
                <span className="text-[13px] text-muted">ETH</span>
                <button className="btn btn-primary btn-sm ml-auto" disabled={back.isPending || b.holdings.length === 0} onClick={() => back.mutate()}>
                  {back.isPending ? 'Backing…' : 'Back'}
                </button>
              </div>
              <div className="mt-1 text-[11.5px] text-faint">paper balance {eth(balanceEth, 3)} ETH</div>
              {back.isError && <div className="mt-2 text-[12.5px] text-down">{(back.error as Error).message}</div>}
              {back.isSuccess && <div className="mt-2 text-[12.5px] text-up">Backed. Your basket is below and in Portfolio.</div>}
            </>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3">
            <span className="label">Your backings</span>
            <span className="text-[11px] text-faint">{open.length} open</span>
          </div>
          <ul className="divide-y divide-line px-2 pb-2 pt-2 text-[13px]">
            {open.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-2 py-2">
                <span>
                  <span className="num">{eth(Number(BigInt(m.ethIn)) / 1e18, 3)} ETH</span>
                  <span className="text-muted"> · {timeAgo(m.openedTs)} ago · {m.holdings.length} tokens</span>
                  <span className={`num block text-[12px] ${m.pnlEth >= 0 ? 'text-up' : 'text-down'}`}>
                    now {eth(m.markEth, 3)} ETH ({m.pnlEth >= 0 ? '+' : ''}
                    {eth(m.pnlEth, 3)})
                  </span>
                </span>
                <button className="btn btn-ghost btn-sm" disabled={unwind.isPending} onClick={() => unwind.mutate(m.id)}>
                  Unwind
                </button>
              </li>
            ))}
            {open.length === 0 && <li className="px-2 py-2 text-muted">Nothing yet.</li>}
          </ul>
          {unwind.isError && <div className="px-4 pb-3 text-[12.5px] text-down">{(unwind.error as Error).message}</div>}
        </div>

        <div className="card-flat p-4 text-[12.5px] text-muted">
          <div className="label">Why this is honest</div>
          <p className="mt-1">
            The basket is read from the chain, not declared by the trader. Every sell they make shows on the{' '}
            <Link href="/tape" className="text-pen hover:underline">
              Tape
            </Link>{' '}
            as it lands, so backers see the exit before the price does.
          </p>
        </div>
      </div>
    </div>
  )
}
