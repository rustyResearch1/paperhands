import Link from 'next/link'
import { formatPrice, formatPct } from '@/lib/format'
import { ethDepth, pctChange, screenerRows, tractionScore, type ScreenerSort } from '@/lib/screener'

export const dynamic = 'force-dynamic'

const SORTS: { key: ScreenerSort; label: string }[] = [
  { key: 'traction', label: 'traction' },
  { key: 'vol', label: 'vol (24h)' },
  { key: 'change5m', label: '5m' },
  { key: 'change30m', label: '30m' },
  { key: 'trades', label: 'trades' },
  { key: 'depth', label: 'depth' },
]

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-faint">—</span>
  const cls = value > 0.005 ? 'text-up' : value < -0.005 ? 'text-down' : 'text-graphite'
  return <span className={cls}>{formatPct(value)}</span>
}

function Traction({ vol30, vol30prev }: { vol30: number; vol30prev: number }) {
  if (vol30 <= 0.001) return <span className="text-faint">—</span>
  if (vol30prev <= 0.001) return <span className="stamp text-pen text-[9px]">waking up</span>
  const x = vol30 / vol30prev
  const cls = x >= 3 ? 'text-up font-bold' : x >= 1.3 ? 'text-up' : x <= 0.5 ? 'text-down' : 'text-graphite'
  return <span className={cls}>{x >= 10 ? `${x.toFixed(0)}×` : `${x.toFixed(1)}×`}</span>
}

export default async function Screener({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; safe?: string }>
}) {
  const params = await searchParams
  const sort = (SORTS.some((s) => s.key === params.sort) ? params.sort : 'vol') as ScreenerSort
  const safe = params.safe !== '0'
  const rows = screenerRows(80, sort, safe ? 3 : 0).filter((r) => !safe || r.factory_verified === 1)

  const link = (s: ScreenerSort) => `/?sort=${s}${safe ? '' : '&safe=0'}`

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-sm font-bold uppercase tracking-[0.14em]">
          the book{' '}
          <span className="text-graphite font-normal normal-case tracking-normal">
            — every WETH pool trading on Robinhood Chain right now
          </span>
        </h1>
        <span className="rule-label">
          <Link
            href={`/?sort=${sort}${safe ? '&safe=0' : ''}`}
            className={`border px-2 py-0.5 ${safe ? 'border-ink bg-marker/30 text-ink font-bold' : 'border-grid text-graphite'}`}
          >
            {safe ? 'rug filter ON' : 'rug filter off'}
          </Link>
          <span className="ml-2">verified pools · ≥3 ETH depth</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="slip p-8 max-w-lg mx-auto my-16 text-center">
          <div className="stamp text-stamp mb-3">no data yet</div>
          <p className="text-graphite">The ledger is blank. Run the indexer to sweep the chain for active pools:</p>
          <pre className="mt-3 text-left bg-paper-2 p-3 border border-grid overflow-x-auto">pnpm --filter @paperhands/indexer dev</pre>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="ledger w-full border-collapse">
            <thead>
              <tr>
                <th>token</th>
                <th>price (ETH)</th>
                {SORTS.map((s) => (
                  <th key={s.key}>
                    <Link
                      href={link(s.key)}
                      className={`hover:underline underline-offset-4 ${sort === s.key ? 'text-ink' : ''}`}
                    >
                      {s.label}
                      {sort === s.key ? ' ▾' : ''}
                    </Link>
                  </th>
                ))}
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
                        <span className="text-faint text-[11px] max-w-36 truncate inline-block align-bottom">{r.baseName}</span>
                      </Link>
                    </td>
                    <td>{formatPrice(r.lastClose ?? 0)}</td>
                    <td>
                      <Traction vol30={r.vol30} vol30prev={r.vol30prev} />
                    </td>
                    <td>{r.vol24.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                    <td>
                      <Change value={pctChange(r.lastClose, r.close5m)} />
                    </td>
                    <td>
                      <Change value={pctChange(r.lastClose, r.close30m)} />
                    </td>
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
        traction = last 30m volume vs the 30m before — volume is the one signal a rug can&rsquo;t fake for
        free. &ldquo;waking up&rdquo; = volume from a standing start. depth = in-range ETH-side liquidity:
        thin depth means your exit is a rumor. the rug filter hides unverified pools and depth under 3 ETH.
      </p>
    </div>
  )
}
