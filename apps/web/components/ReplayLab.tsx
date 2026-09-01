'use client'

import { useState } from 'react'

interface PoolResult {
  pool: string
  baseSymbol: string
  mirroredBuys: number
  mirroredSells: number
  investedQuote: number
  returnedQuote: number
  pnlQuote: number
}

interface ReplayResult {
  sizeEth: number
  pools: PoolResult[]
  totalInvested: number
  totalReturned: number
  totalPnl: number
  hours: number
  error?: string
}

const fmt = (n: number, d = 4) => n.toLocaleString('en-US', { maximumFractionDigits: d })

export default function ReplayLab({ wallet }: { wallet: string }) {
  const [eth, setEth] = useState('0.25')
  const [hours, setHours] = useState(24)
  const [r, setR] = useState<ReplayResult | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setPending(true)
    setError(null)
    setR(null)
    try {
      const res = await fetch(`/api/replay?wallet=${wallet}&eth=${eth}&hours=${hours}`)
      const json = await res.json()
      if (json.error) setError(json.error)
      else setR(json)
    } catch {
      setError('Replay failed — try a shorter window.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="slip p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="rule-label">replay — would tailing them have worked?</span>
        <span className="stamp text-stamp text-[9px]">time travel</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <label className="block">
          <span className="rule-label">your size per buy (ETH)</span>
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
            {[6, 24, 72].map((h) => (
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
        disabled={pending || !(Number.parseFloat(eth) > 0)}
        className="mt-3 w-full border-2 border-ink py-2 text-[12px] font-bold uppercase tracking-[0.14em] bg-pen text-paper shadow-[3px_3px_0_rgba(28,33,39,0.25)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
      >
        {pending ? 'replaying their trades at your size…' : 'run the replay'}
      </button>

      {error && <p className="text-down mt-3 text-[12px]">{error}</p>}
      {r && (
        <div className="mt-3 border-t-2 border-dashed border-ink pt-3 text-[12px]">
          <table className="ledger w-full mb-2">
            <thead>
              <tr>
                <th>token</th>
                <th>fills</th>
                <th>in</th>
                <th>out</th>
                <th>pnl (ETH)</th>
              </tr>
            </thead>
            <tbody>
              {r.pools.map((p) => (
                <tr key={p.pool}>
                  <td className="font-bold">{p.baseSymbol}</td>
                  <td className="text-graphite">
                    {p.mirroredBuys}b/{p.mirroredSells}s
                  </td>
                  <td>{fmt(p.investedQuote, 3)}</td>
                  <td>{fmt(p.returnedQuote, 3)}</td>
                  <td className={p.pnlQuote >= 0 ? 'text-up font-bold' : 'text-down font-bold'}>
                    {p.pnlQuote >= 0 ? '+' : ''}
                    {fmt(p.pnlQuote, 3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <span className="hilite font-bold">
              copying them with {fmt(r.sizeEth, 2)} ETH per buy: {r.totalPnl >= 0 ? '+' : ''}
              {fmt(r.totalPnl)} ETH on {fmt(r.totalInvested, 2)} deployed
            </span>
          </p>
          <p className="rule-label mt-1">
            leftover bags exit at the end state — realizable, not marked. your fills pay your own impact,
            which is exactly why copying whales at retail size often disappoints.
          </p>
        </div>
      )}
    </div>
  )
}
