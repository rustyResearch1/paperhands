import Link from 'next/link'
import { timeAgo } from '@/lib/format'
import { topTraders } from '@/lib/wire'

export const dynamic = 'force-dynamic'

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d })

export default function Wire() {
  const rows = topTraders(50, 5)
  return (
    <div className="space-y-5">
      <div className="rise">
        <h1 className="text-[28px] font-semibold tracking-tight">Wire</h1>
        <p className="text-muted">Real wallets, ranked by ETH actually taken out of pools — marked bags don&rsquo;t count.</p>
      </div>

      {rows.length === 0 ? (
        <div className="card mx-auto my-12 max-w-md p-8 text-center">
          <div className="pill mb-3">no wires yet</div>
          <p className="text-muted">Trader attribution fills in as the indexer runs. Give it a few minutes.</p>
        </div>
      ) : (
        <div className="card rise rise-2 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Net flow</th>
                  <th>Open bags (marked)</th>
                  <th>Volume</th>
                  <th>Buys</th>
                  <th>Sells</th>
                  <th>Pools</th>
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
                    <td className={r.netFlowEth >= 0 ? 'text-up font-semibold' : 'text-down font-semibold'}>
                      {r.netFlowEth >= 0 ? '+' : ''}
                      {fmt(r.netFlowEth)} ETH
                    </td>
                    <td className="text-muted">{fmt(r.openMarkEth)} ETH</td>
                    <td>{fmt(r.volEth, 1)}</td>
                    <td className="text-up">{r.buys}</td>
                    <td className="text-down">{r.sells}</td>
                    <td>{r.pools}</td>
                    <td className="text-muted">{timeAgo(r.lastTs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-[12px] text-faint">
        Net flow = ETH pulled out of pools minus ETH put in, within the tracked window. A wallet still holding bags shows negative
        flow and a big &ldquo;marked&rdquo; column — that money isn&rsquo;t real until they find an exit. Open a wallet to replay it before you tail it.
      </p>
    </div>
  )
}
