import Link from 'next/link'
import Warming from '@/components/Warming'
import { formatUsd } from '@/lib/format'
import { isXChain } from '@/lib/x'
import { lpScreenOrNull } from '@/lib/x/lp'
import { CHAIN_LABEL, type XChain } from '@/lib/x/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'LP screener' }

const pct = (v: number, d = 2) => `${v.toFixed(d)}%`

export default async function LpScreener({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const { chain } = await searchParams
  const chains: XChain[] = isXChain(chain) ? [chain] : ['rh', 'sol', 'bsc']
  const screen = lpScreenOrNull(chains)
  const filters: { id: string; label: string }[] = [
    { id: '', label: 'All chains' },
    { id: 'rh', label: 'Robinhood Chain' },
    { id: 'sol', label: 'Solana' },
    { id: 'bsc', label: 'BNB Chain' },
  ]

  return (
    <div className="space-y-5">
      <div className="rise">
        <h1 className="text-[28px] font-semibold tracking-tight">LP screener</h1>
        <p className="max-w-3xl text-muted">
          Where liquidity actually pays. Every pool is ranked by <span className="font-semibold text-ink">fee-to-vol</span> — the fees it earned in 24h
          relative to its TVL, divided by the realized volatility that pushes a range out of play. High fee yield on a calm pair beats a
          screaming APR on something that moves 80% a day.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link key={f.id} href={f.id ? `/lp?chain=${f.id}` : '/lp'} className={`chip ${(chain ?? '') === f.id ? 'chip-active' : ''}`}>
            {f.label}
          </Link>
        ))}
      </div>

      {screen === null && <Warming what="The LP screener" seconds={40} />}
      {screen !== null && (
      <div className="card rise rise-2 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Pool</th>
                <th>Fee</th>
                <th>TVL</th>
                <th className="hidden md:table-cell">Vol 24h</th>
                <th>Fees 24h</th>
                <th>Yield / day</th>
                <th className="hidden md:table-cell">APR</th>
                <th className="hidden md:table-cell">σ 24h</th>
                <th>Fee-to-vol</th>
                <th className="hidden md:table-cell">Balanced range</th>
              </tr>
            </thead>
            <tbody>
              {screen.rows.map((r) => (
                <tr key={`${r.chain}:${r.address}`}>
                  <td>
                    <Link href={r.href} className="block">
                      <span className="block font-semibold leading-tight">{r.name}</span>
                      <span className="block text-[12px] text-muted">
                        {CHAIN_LABEL[r.chain]} · {r.dex}
                        {r.executable ? ' · open from PaperHands' : ''}
                      </span>
                    </Link>
                  </td>
                  <td className="text-muted">{pct(r.feePct, r.feePct < 0.1 ? 3 : 2)}</td>
                  <td>{formatUsd(r.tvlUsd)}</td>
                  <td className="hidden md:table-cell">{formatUsd(r.vol24Usd)}</td>
                  <td>{formatUsd(r.fees24Usd)}</td>
                  <td className={`font-semibold ${r.feeYieldDayPct >= 1 ? 'text-up' : ''}`}>{pct(r.feeYieldDayPct)}</td>
                  <td className="hidden text-muted md:table-cell">{r.aprPct >= 1000 ? `${(r.aprPct / 100).toFixed(0)}×` : pct(r.aprPct, 0)}</td>
                  <td className={`hidden md:table-cell ${r.sigma24Pct === null ? 'text-faint' : r.sigma24Pct > 60 ? 'text-down' : r.sigma24Pct > 25 ? 'text-warn' : ''}`}>
                    {r.sigma24Pct === null ? '—' : `±${r.sigma24Pct.toFixed(0)}%`}
                  </td>
                  <td className={`font-semibold ${r.score === null ? 'text-faint' : r.score >= 0.05 ? 'text-up' : r.score >= 0.02 ? '' : 'text-muted'}`}>
                    {r.score === null ? '—' : r.score.toFixed(3)}
                  </td>
                  <td className="hidden text-muted md:table-cell">{r.ranges ? `±${r.ranges.balanced}%` : '—'}</td>
                </tr>
              ))}
              {screen.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-muted">
                    No pools loaded{screen.errors.length ? ` — ${screen.errors.join('; ')}` : ''}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
      <p className="text-[12px] text-faint">
        Fee yield = 24h fees ÷ TVL. σ = realized 24h volatility from minute candles (Robinhood Chain: our ledger; others: GeckoTerminal); shown for the top rows only.
        Ranges follow the LP Lab: tight 1σ, balanced 2σ, wide 4σ. Robinhood Chain v3 ETH pools open straight from the token page; Solana and BNB Chain LP positions are next.
        {screen && screen.errors.length ? ` Sources down right now: ${screen.errors.join('; ')}.` : ''}
      </p>
    </div>
  )
}
