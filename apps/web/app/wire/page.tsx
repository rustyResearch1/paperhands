import Link from 'next/link'
import { timeAgo } from '@/lib/format'
import { topTraders } from '@/lib/wire'

export const dynamic = 'force-dynamic'

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d })

export default function Wire() {
  const rows = topTraders(50, 5)
  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-sm font-bold uppercase tracking-[0.14em]">
          the wire <span className="text-graphite font-normal normal-case tracking-normal">— real wallets, ranked by ETH actually taken out of pools</span>
        </h1>
        <span className="rule-label">tracked window only · marked bags are not banked</span>
      </div>

      {rows.length === 0 ? (
        <div className="slip p-8 max-w-md mx-auto my-12 text-center">
          <div className="stamp text-stamp mb-3">no wires yet</div>
          <p className="text-graphite">Trader attribution fills in as the indexer runs. Give it a few minutes.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="ledger w-full">
            <thead>
              <tr>
                <th>wallet</th>
                <th>net flow (ETH)</th>
                <th>open bags (marked)</th>
                <th>vol (ETH)</th>
                <th>buys</th>
                <th>sells</th>
                <th>pools</th>
                <th>last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.trader}>
                  <td>
                    <Link href={`/w/${r.trader}`} className="font-bold hover:underline underline-offset-4">
                      {r.trader.slice(0, 8)}…{r.trader.slice(-6)}
                    </Link>
                  </td>
                  <td className={r.netFlowEth >= 0 ? 'text-up font-bold' : 'text-down font-bold'}>
                    {r.netFlowEth >= 0 ? '+' : ''}
                    {fmt(r.netFlowEth)}
                  </td>
                  <td className="text-graphite">{fmt(r.openMarkEth)}</td>
                  <td>{fmt(r.volEth, 1)}</td>
                  <td className="text-up">{r.buys}</td>
                  <td className="text-down">{r.sells}</td>
                  <td>{r.pools}</td>
                  <td className="text-graphite">{timeAgo(r.lastTs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rule-label mt-3">
            net flow = ETH pulled out of pools minus ETH put in, within the tracked window. a wallet still
            holding bags shows negative flow and a big &ldquo;marked&rdquo; column — that money isn&rsquo;t real until they
            find an exit. click a wallet to study it or tail it.
          </p>
        </div>
      )}
    </div>
  )
}
