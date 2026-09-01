'use client'

import { useState } from 'react'

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

const fmt = (n: number, d = 4) => n.toLocaleString('en-US', { maximumFractionDigits: d })

export default function LpLab({ pool }: { pool: string }) {
  const [range, setRange] = useState(30)
  const [eth, setEth] = useState('1')
  const [hours, setHours] = useState(24)
  const [r, setR] = useState<LpResult | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      ? 'fees beat the bleed — LPing won here'
      : r.endValueWithFees >= r.hodlValue
        ? 'beat holding, still under water vs cash'
        : 'the fees did not cover what the range lost')

  return (
    <div className="slip p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="rule-label">lp lab — would providing liquidity have paid?</span>
        <span className="stamp text-stamp text-[9px]">replayed</span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-[12px]">
        <label className="block">
          <span className="rule-label">range ±%</span>
          <div className="flex gap-1 mt-1">
            {[10, 30, 100].map((p) => (
              <button
                key={p}
                onClick={() => setRange(p)}
                className={`border px-2 py-1 ${range === p ? 'border-ink font-bold bg-marker/30' : 'border-grid'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </label>
        <label className="block">
          <span className="rule-label">deposit (ETH)</span>
          <input
            type="text"
            inputMode="decimal"
            value={eth}
            onChange={(e) => setEth(e.target.value)}
            className="mt-1 w-full border-2 border-ink bg-paper px-2 py-1 font-semibold focus:outline-2 focus:outline-pen"
          />
        </label>
        <label className="block">
          <span className="rule-label">lookback</span>
          <div className="flex gap-1 mt-1">
            {[3, 24, 72].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={`border px-2 py-1 ${hours === h ? 'border-ink font-bold bg-marker/30' : 'border-grid'}`}
              >
                {h}h
              </button>
            ))}
          </div>
        </label>
      </div>

      <button
        onClick={run}
        disabled={pending}
        className="mt-3 w-full border-2 border-ink py-2 text-[12px] font-bold uppercase tracking-[0.14em] bg-pen text-paper shadow-[3px_3px_0_rgba(28,33,39,0.25)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
      >
        {pending ? 'replaying every swap…' : 'run the counterfactual'}
      </button>

      {error && <p className="text-down mt-3 text-[12px]">{error}</p>}
      {r && (
        <div className="mt-3 border-t-2 border-dashed border-ink pt-3 space-y-1.5 text-[12px]">
          <Row label={`replayed`} value={`${r.swapsReplayed.toLocaleString()} swaps over ${fmt(r.hours, 1)}h`} />
          <Row label="fees earned" value={`${fmt(r.feesEarned)} ETH`} strong />
          <Row label="position at exit" value={`${fmt(r.positionEndValue)} ETH`} />
          <Row label="if you had just held the tokens" value={`${fmt(r.hodlValue)} ETH`} />
          <Row
            label="impermanent loss"
            value={`${r.impermanentLoss >= 0 ? '−' : '+'}${fmt(Math.abs(r.impermanentLoss))} ETH`}
            valueClass={r.impermanentLoss > 0 ? 'text-down' : 'text-up'}
          />
          <Row
            label="net vs holding"
            value={`${r.netVsHodl >= 0 ? '+' : ''}${fmt(r.netVsHodl)} ETH`}
            valueClass={r.netVsHodl >= 0 ? 'text-up font-bold' : 'text-down font-bold'}
          />
          <Row label="fee run-rate" value={`${fmt(r.aprPct, 1)}% APR`} />
          <p className="pt-1">
            <span className="hilite font-bold">{verdict}</span>
          </p>
        </div>
      )}
      <p className="rule-label mt-2">
        parallel-universe honest: your liquidity is added to the pool and every recorded swap re-executes
        through it — you earn your exact share, and prices move because you were there.
      </p>
    </div>
  )
}

function Row({ label, value, strong, valueClass }: { label: string; value: string; strong?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-graphite">{label}</span>
      <span className={`tabular-nums text-right ${strong ? 'font-bold' : ''} ${valueClass ?? ''}`}>{value}</span>
    </div>
  )
}
