import Link from 'next/link'
import AlertsFeed from '@/components/AlertsFeed'
import WalletSearch from '@/components/WalletSearch'
import { marketAlerts } from '@/lib/alerts'
import { timeAgo } from '@/lib/format'
import { topTraders } from '@/lib/wire'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Wire' }

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d })

type Sort = 'flow' | 'realized' | 'win'

export default async function Wire({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort: sortRaw } = await searchParams
  const sort: Sort = sortRaw === 'realized' || sortRaw === 'win' ? sortRaw : 'flow'
  const ranked = topTraders(100, 5)
  const rows = [...ranked]
    .sort((a, b) => (sort === 'realized' ? b.realizedEth - a.realizedEth : sort === 'win' ? (b.winRate ?? -1) - (a.winRate ?? -1) || b.realizedEth - a.realizedEth : b.netFlowEth - a.netFlowEth))
    .slice(0, 50)
  let alerts: ReturnType<typeof marketAlerts> = []
  try {
    alerts = marketAlerts(20)
  } catch {
    // alerts are a bonus; the wire must render without them
  }
  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Wire</h1>
          <p className="text-muted">Real wallets, ranked by ETH actually taken out of pools — marked bags don&rsquo;t count. Open any wallet for its swaps and true P&amp;L.</p>
        </div>
        <WalletSearch />
      </div>

      <div className="rise rise-1">
        <AlertsFeed alerts={alerts} />
      </div>

      {rows.length === 0 ? (
        <div className="card mx-auto my-12 max-w-md p-8 text-center">
          <div className="pill mb-3">no wires yet</div>
          <p className="text-muted">Trader attribution fills in as the indexer runs. Give it a few minutes.</p>
        </div>
      ) : (
        <div className="card rise rise-2 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <span className="label">Profitable wallets</span>
            <div className="flex gap-1.5">
              {(
                [
                  ['flow', 'Net flow'],
                  ['realized', 'Realized P&L'],
                  ['win', 'Win rate'],
                ] as [Sort, string][]
              ).map(([id, label]) => (
                <Link key={id} href={id === 'flow' ? '/wire' : `/wire?sort=${id}`} className={`chip ${sort === id ? 'chip-active' : ''}`}>
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto pt-2">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Realized</th>
                  <th>Win rate</th>
                  <th className="hidden md:table-cell">Best · worst</th>
                  <th>Net flow</th>
                  <th className="hidden md:table-cell">Volume</th>
                  <th className="hidden md:table-cell">Trades</th>
                  <th>Seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.trader}>
                    <td>
                      <Link href={`/w/${r.trader}`} className="flex items-center gap-3">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-bg-3 text-[12px] font-bold text-muted">{i + 1}</span>
                        <span className="num font-semibold">
                          {r.trader.slice(0, 8)}…{r.trader.slice(-6)}
                        </span>
                      </Link>
                    </td>
                    <td className={r.realizedEth >= 0 ? 'text-up font-semibold' : 'text-down font-semibold'}>
                      {r.realizedEth >= 0 ? '+' : ''}
                      {fmt(r.realizedEth)} ETH
                    </td>
                    <td className={r.winRate === null ? 'text-faint' : r.winRate >= 0.6 ? 'text-up' : r.winRate < 0.4 ? 'text-down' : ''}>
                      {r.winRate === null ? '—' : `${(r.winRate * 100).toFixed(0)}%`}
                      <span className="ml-1 text-[11px] text-faint">
                        {r.wins}W {r.losses}L
                      </span>
                    </td>
                    <td className="hidden md:table-cell">
                      {r.bestSymbol ? <span className="text-up">{r.bestSymbol}</span> : <span className="text-faint">—</span>}
                      <span className="text-faint"> · </span>
                      {r.worstSymbol ? <span className="text-down">{r.worstSymbol}</span> : <span className="text-faint">—</span>}
                    </td>
                    <td className={r.netFlowEth >= 0 ? 'text-up' : 'text-down'}>
                      {r.netFlowEth >= 0 ? '+' : ''}
                      {fmt(r.netFlowEth)}
                    </td>
                    <td className="hidden md:table-cell">{fmt(r.volEth, 1)}</td>
                    <td className="hidden text-muted md:table-cell">
                      <span className="text-up">{r.buys}</span>/<span className="text-down">{r.sells}</span>
                    </td>
                    <td className="text-muted">{timeAgo(r.lastTs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 pt-2 text-[12px] text-faint">
            Realized = ETH banked on sells minus the pro-rata cost of what was sold, over attributed swaps in ETH-quoted pools; stablecoin legs excluded. Open bags are not counted until sold —
            open a wallet to see what the pool would pay for them.
          </p>
        </div>
      )}
      <p className="text-[12px] text-faint">
        Net flow = ETH pulled out of pools minus ETH put in, within the tracked window. A wallet still holding bags shows negative
        flow and a big &ldquo;marked&rdquo; column — that money isn&rsquo;t real until they find an exit. Open a wallet to replay it before you tail it.
      </p>
    </div>
  )
}
