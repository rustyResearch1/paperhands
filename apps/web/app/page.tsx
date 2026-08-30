import Link from 'next/link'
import { formatPrice, formatPct } from '@/lib/format'
import { ethDepth, pctChange, screenerRows } from '@/lib/screener'

export const dynamic = 'force-dynamic'

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-faint">—</span>
  const cls = value > 0.005 ? 'text-up' : value < -0.005 ? 'text-down' : 'text-graphite'
  return <span className={cls}>{formatPct(value)}</span>
}

export default function Screener() {
  const rows = screenerRows(80)
  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-sm font-bold uppercase tracking-[0.14em]">
          the book <span className="text-graphite font-normal normal-case tracking-normal">— every WETH pool trading on Robinhood Chain right now</span>
        </h1>
        <span className="rule-label">fills simulated against live liquidity · prices in ETH</span>
      </div>

      {rows.length === 0 ? (
        <div className="slip p-8 max-w-lg mx-auto my-16 text-center">
          <div className="stamp text-stamp mb-3">no data yet</div>
          <p className="text-graphite">
            The ledger is blank. Run the indexer to sweep the chain for active pools:
          </p>
          <pre className="mt-3 text-left bg-paper-2 p-3 border border-grid overflow-x-auto">pnpm --filter @paperhands/indexer dev</pre>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="ledger w-full border-collapse">
            <thead>
              <tr>
                <th>token</th>
                <th>price (ETH)</th>
                <th>5m</th>
                <th>30m</th>
                <th>vol (ETH, 24h)</th>
                <th>trades</th>
                <th>depth (ETH)</th>
                <th>fee</th>
                <th>book</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const depth = ethDepth(r)
                return (
                  <tr key={r.address}>
                    <td>
                      <Link href={`/t/${r.address}`} className="flex items-baseline gap-2 hover:underline underline-offset-4">
                        <b>{r.baseSymbol}</b>
                        <span className="text-faint text-[11px] max-w-40 truncate inline-block align-bottom">{r.baseName}</span>
                      </Link>
                    </td>
                    <td>{formatPrice(r.lastClose ?? 0)}</td>
                    <td><Change value={pctChange(r.lastClose, r.close5m)} /></td>
                    <td><Change value={pctChange(r.lastClose, r.close30m)} /></td>
                    <td>{r.vol24.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                    <td>{r.trades24.toLocaleString('en-US')}</td>
                    <td className={depth < 5 ? 'text-down font-semibold' : depth < 25 ? 'text-graphite' : ''}>
                      {depth ? depth.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—'}
                    </td>
                    <td className="text-graphite">{(r.fee / 10000).toFixed(2)}%</td>
                    <td>
                      {r.factory_verified ? (
                        <span className="text-up text-[11px]">uniswap ✓</span>
                      ) : (
                        <span className="stamp text-stamp text-[9px]">unverified</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="rule-label mt-3">
        depth = in-range ETH-side liquidity. thin depth means your exit is a rumor. unverified = the pool
        contract did not come from the Uniswap factory — treat as hostile.
      </p>
    </div>
  )
}
