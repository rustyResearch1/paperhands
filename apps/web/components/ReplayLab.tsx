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
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="label">Replay</span>
        <span className="pill">time travel</span>
      </div>
      <p className="mb-4 text-[13.5px] text-muted">Would tailing this wallet have worked at your size? Their recorded trades, mirrored with your bankroll.</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label mb-1.5 block" htmlFor="rp-eth">
            Per buy (ETH)
          </label>
          <input id="rp-eth" type="text" inputMode="decimal" value={eth} onChange={(e) => setEth(e.target.value)} className="field field-sm num" />
        </div>
        <div>
          <span className="label mb-1.5 block">Lookback</span>
          <div className="flex gap-1">
            {[6, 24, 72].map((h) => (
              <button key={h} onClick={() => setHours(h)} className={`chip h-8 flex-1 justify-center px-0 ${hours === h ? 'chip-active' : ''}`}>
                {h}h
              </button>
            ))}
          </div>
        </div>
      </div>

      <button onClick={run} disabled={pending || !(Number.parseFloat(eth) > 0)} className="btn btn-pen mt-4 w-full">
        {pending ? 'Replaying their trades at your size…' : 'Run the replay'}
      </button>

      {error && <p className="mt-3 rounded-xl bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
      {r && (
        <div className="mt-4 border-t border-line pt-3 text-[13.5px]">
          <table className="tbl mb-3">
            <thead>
              <tr>
                <th>Token</th>
                <th>Fills</th>
                <th>In</th>
                <th>Out</th>
                <th>PnL</th>
              </tr>
            </thead>
            <tbody>
              {r.pools.map((p) => (
                <tr key={p.pool}>
                  <td className="font-semibold">{p.baseSymbol}</td>
                  <td className="text-muted">
                    {p.mirroredBuys}b/{p.mirroredSells}s
                  </td>
                  <td>{fmt(p.investedQuote, 3)}</td>
                  <td>{fmt(p.returnedQuote, 3)}</td>
                  <td className={p.pnlQuote >= 0 ? 'text-up font-semibold' : 'text-down font-semibold'}>
                    {p.pnlQuote >= 0 ? '+' : ''}
                    {fmt(p.pnlQuote, 3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`rounded-xl px-3 py-2 text-[13px] font-semibold ${r.totalPnl >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
            Copying them at {fmt(r.sizeEth, 2)} ETH per buy: {r.totalPnl >= 0 ? '+' : ''}
            {fmt(r.totalPnl)} ETH on {fmt(r.totalInvested, 2)} deployed
          </p>
          <p className="mt-2 text-[12px] text-faint">Leftover bags exit at the end state — realizable, not marked. Your fills pay your own impact.</p>
        </div>
      )}
    </div>
  )
}
