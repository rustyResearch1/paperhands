'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { formatUsd } from '@/lib/format'

interface Result {
  hours: number
  candles: number
  depositUsd: number
  inRangePct: number
  feesUsd: number
  ilUsd: number
  netUsd: number
  netPct: number
  aprPct: number
  sharePct: number
  poolFeePct: number
  error?: string
}

/** "Would this range have paid?" for Solana / BNB Chain pools — approximate, and says so. */
export default function XLpBacktest({ chain, pool, rangePct, depositUsd }: { chain: 'sol' | 'bsc'; pool: string | null; rangePct: number | null; depositUsd: number | null }) {
  const [hours, setHours] = useState(16)
  const enabled = Boolean(pool) && rangePct !== null && Boolean(depositUsd && depositUsd > 0)
  const q = useQuery({
    queryKey: ['xbt', chain, pool, rangePct, Math.round(depositUsd ?? 0), hours],
    queryFn: async () => (await fetch(`/api/lp/xbacktest?chain=${chain}&pool=${pool}&range=${rangePct}&usd=${Math.round(depositUsd!)}&hours=${hours}`)).json() as Promise<Result>,
    enabled,
    staleTime: 60_000,
  })
  const r = q.data
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label">Backtest · approximate</span>
        <div className="flex gap-1">
          {[4, 8, 16].map((h) => (
            <button key={h} onClick={() => setHours(h)} className={`chip h-7 px-2.5 text-[12px] ${hours === h ? 'chip-active' : ''}`}>
              {h}h
            </button>
          ))}
        </div>
      </div>
      {!enabled && <p className="mt-2 text-[12.5px] text-faint">Pick a range and a deposit to backtest.</p>}
      {q.isLoading && enabled && <p className="mt-2 text-[12.5px] text-faint">Replaying candles…</p>}
      {r?.error && <p className="mt-2 text-[12.5px] text-down">{r.error}</p>}
      {r && !r.error && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
            <Cell label="Fees earned" value={formatUsd(r.feesUsd)} tone="up" />
            <Cell label="Impermanent loss" value={formatUsd(r.ilUsd)} tone={r.ilUsd < 0 ? 'down' : 'muted'} />
            <Cell label="Net vs holding" value={`${r.netUsd >= 0 ? '+' : ''}${formatUsd(r.netUsd)} · ${r.netPct.toFixed(2)}%`} tone={r.netUsd >= 0 ? 'up' : 'down'} strong />
            <Cell label="Fee APR run-rate" value={`${r.aprPct.toFixed(0)}%`} tone="muted" />
            <Cell label="Time in range" value={`${r.inRangePct.toFixed(0)}%`} tone={r.inRangePct < 50 ? 'warn' : 'muted'} />
            <Cell label="Your share of range" value={`${r.sharePct.toFixed(2)}%`} tone="muted" />
          </div>
          <p className="mt-2 text-[11.5px] text-faint">
            {r.candles} one-minute candles over {r.hours.toFixed(1)}h · fees = volume × {r.poolFeePct.toFixed(2)}% × your share of in-range liquidity (assumed constant) · IL from the price path. Robinhood Chain backtests replay every swap exactly; this one is an estimate.
          </p>
        </>
      )}
    </div>
  )
}

function Cell({ label, value, tone, strong }: { label: string; value: string; tone: 'up' | 'down' | 'warn' | 'muted'; strong?: boolean }) {
  const cls = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'warn' ? 'text-warn' : 'text-muted'
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className={`num ${cls} ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  )
}
