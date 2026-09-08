'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import RealLpMint from '@/components/RealLpMint'
import { useMode } from '@/lib/mode'

interface LpResult {
  baseSymbol: string
  tickLower: number
  tickUpper: number
  deposit: number
  positionEndValue: number
  feesEarned: number
  endValueWithFees: number
  hodlValue: number
  impermanentLoss: number
  netVsHodl: number
  aprPct: number
  swapsReplayed: number
  hours: number
  error?: string
}
interface Strategy {
  sigma24Pct: number
  candles: number
  ranges: { label: string; pct: number; sigmas: number; note: string }[]
}

const fmt = (n: number, d = 4) => n.toLocaleString('en-US', { maximumFractionDigits: d })

interface Props {
  pool: string
  baseAddress: string
  baseSymbol: string
  baseDecimals: number
}

export default function LpLab({ pool, baseAddress, baseSymbol, baseDecimals }: Props) {
  const { mode } = useMode()
  const [range, setRange] = useState(30)
  const [eth, setEth] = useState('1')
  const [hours, setHours] = useState(24)
  const [r, setR] = useState<LpResult | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const strategy = useQuery({
    queryKey: ['strategy', pool],
    queryFn: async () => (await fetch(`/api/lp/plan?pool=${pool}`)).json() as Promise<{ strategy?: Strategy; error?: string }>,
    staleTime: 60_000,
  })
  const s = strategy.data?.strategy

  async function run() {
    setPending(true)
    setError(null)
    setR(null)
    try {
      const res = await fetch(`/api/lp?pool=${pool}&range=${range}&eth=${eth}&hours=${hours}`)
      const json = await res.json()
      if (json.error) setError(json.error)
      else setR(json)
    } catch {
      setError('Backtest failed — try a shorter window.')
    } finally {
      setPending(false)
    }
  }

  const verdict =
    r &&
    (r.endValueWithFees >= r.deposit && r.netVsHodl >= 0
      ? { text: 'Fees beat the bleed — LPing won here', tone: 'up' }
      : r.endValueWithFees >= r.hodlValue
        ? { text: 'Beat holding, still under water vs cash', tone: 'warn' }
        : { text: 'The fees did not cover what the range lost', tone: 'down' })

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">LP Lab</span>
        <span className="pill">replayed on real swaps</span>
      </div>
      <p className="mb-4 text-[13.5px] text-muted">Would providing liquidity have paid? Your position is added to the pool and every recorded swap re-executes through it.</p>

      {s && (
        <div className="mb-4 rounded-xl bg-bg-2 p-3">
          <div className="flex items-baseline justify-between">
            <span className="label">Suggested ranges</span>
            <span className="num text-[12px] text-muted">24h realized vol ±{s.sigma24Pct.toFixed(0)}%{s.candles < 30 ? ' · thin history' : ''}</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {s.ranges.map((x) => (
              <button key={x.label} onClick={() => setRange(x.pct)} title={x.note} className={`chip h-8 flex-1 justify-center px-0 ${range === x.pct ? 'chip-active' : ''}`}>
                {x.label} ±{x.pct}%
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label mb-1.5 block" htmlFor="lp-range">
            Range ±%
          </label>
          <input id="lp-range" type="text" inputMode="numeric" value={range} onChange={(e) => setRange(Number(e.target.value) || 0)} className="field field-sm num" />
        </div>
        <div>
          <label className="label mb-1.5 block" htmlFor="lp-eth">
            Deposit ETH
          </label>
          <input id="lp-eth" type="text" inputMode="decimal" value={eth} onChange={(e) => setEth(e.target.value)} className="field field-sm num" />
        </div>
        <div>
          <span className="label mb-1.5 block">Lookback</span>
          <div className="flex gap-1">
            {[3, 24, 72].map((h) => (
              <button key={h} onClick={() => setHours(h)} className={`chip h-8 flex-1 justify-center px-0 ${hours === h ? 'chip-active' : ''}`}>
                {h}h
              </button>
            ))}
          </div>
        </div>
      </div>

      <button onClick={run} disabled={pending || !(range >= 1 && range <= 300)} className="btn btn-pen mt-4 w-full">
        {pending ? 'Replaying every swap…' : 'Run the backtest'}
      </button>

      {error && <p className="mt-3 rounded-xl bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
      {r && verdict && (
        <div className="mt-4 space-y-2 border-t border-line pt-4 text-[13.5px]">
          <Row label="Replayed" value={`${r.swapsReplayed.toLocaleString()} swaps · ${fmt(r.hours, 1)}h`} />
          <Row label="Fees earned" value={`${fmt(r.feesEarned)} ETH`} strong />
          <Row label="Position at exit" value={`${fmt(r.positionEndValue)} ETH`} />
          <Row label="If you just held" value={`${fmt(r.hodlValue)} ETH`} />
          <Row label="Impermanent loss" value={`${r.impermanentLoss >= 0 ? '−' : '+'}${fmt(Math.abs(r.impermanentLoss))} ETH`} valueClass={r.impermanentLoss > 0 ? 'text-down' : 'text-up'} />
          <Row label="Net vs holding" value={`${r.netVsHodl >= 0 ? '+' : ''}${fmt(r.netVsHodl)} ETH`} valueClass={r.netVsHodl >= 0 ? 'text-up font-semibold' : 'text-down font-semibold'} />
          <Row label="Fee run-rate" value={`${fmt(r.aprPct, 0)}% APR`} />
          <p className={`mt-2 rounded-xl px-3 py-2 text-[13px] font-semibold ${verdict.tone === 'up' ? 'bg-up-soft text-up' : verdict.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-down-soft text-down'}`}>
            {verdict.text}
          </p>
        </div>
      )}

      {mode === 'real' && (
        <RealLpMint pool={pool} baseAddress={baseAddress} baseSymbol={baseSymbol} baseDecimals={baseDecimals} rangePct={range} eth={eth} />
      )}
    </div>
  )
}

function Row({ label, value, strong, valueClass }: { label: string; value: string; strong?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={`num text-right ${strong ? 'font-semibold' : ''} ${valueClass ?? ''}`}>{value}</span>
    </div>
  )
}
