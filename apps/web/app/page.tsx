import Link from 'next/link'
import { formatPct, formatPrice, formatUsd } from '@/lib/format'
import { pctChange, quoteDepth, screenerRows, type GroupedRow, type ScreenerSort } from '@/lib/screener'
import { ethUsdRate } from '@/lib/usd'

export const dynamic = 'force-dynamic'

const SORTS: { key: ScreenerSort; label: string }[] = [
  { key: 'traction', label: 'Traction' },
  { key: 'vol', label: 'Volume' },
  { key: 'change5m', label: '5m' },
  { key: 'change30m', label: '30m' },
  { key: 'trades', label: 'Trades' },
  { key: 'depth', label: 'Depth' },
]

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-faint">—</span>
  const cls = value > 0.005 ? 'text-up' : value < -0.005 ? 'text-down' : 'text-muted'
  return <span className={cls}>{formatPct(value)}</span>
}

function Traction({ vol30, vol30prev }: { vol30: number; vol30prev: number }) {
  if (vol30 <= 0.001) return <span className="text-faint">—</span>
  if (vol30prev <= 0.001) return <span className="pill pill-pen">waking up</span>
  const x = vol30 / vol30prev
  const cls = x >= 3 ? 'pill pill-up' : x >= 1.3 ? 'text-up' : x <= 0.5 ? 'text-down' : 'text-muted'
  return <span className={cls}>{x >= 10 ? `${x.toFixed(0)}×` : `${x.toFixed(1)}×`}</span>
}

export default async function Markets({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; safe?: string; ccy?: string }>
}) {
  const params = await searchParams
  const sort = (SORTS.some((s) => s.key === params.sort) ? params.sort : 'traction') as ScreenerSort
  const safe = params.safe !== '0'
  const rate = ethUsdRate()
  const usd = params.ccy !== 'eth' && rate !== null
  const rows = screenerRows(80, sort, safe ? 3 : 0).filter((r) => !safe || r.factory_verified === 1)

  const link = (s: ScreenerSort, opts: { safe?: boolean; usd?: boolean } = {}) =>
    `/?sort=${s}${(opts.safe ?? safe) ? '' : '&safe=0'}${(opts.usd ?? usd) ? '' : '&ccy=eth'}`

  // Face-pool quote → display currency.
  const money = (v: number, quote: string) => {
    if (usd) return formatUsd(quote === 'USDG' ? v : v * (rate ?? 0))
    const eth = quote === 'USDG' ? (rate ? v / rate : 0) : v
    return eth.toLocaleString('en-US', { maximumFractionDigits: eth >= 100 ? 0 : 2 })
  }
  const price = (r: GroupedRow) => {
    const p = r.lastClose ?? 0
    if (usd) return formatUsd(r.quote_symbol === 'USDG' ? p : p * (rate ?? 0))
    return formatPrice(r.quote_symbol === 'USDG' ? (rate ? p / rate : 0) : p)
  }

  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Markets</h1>
          <p className="text-muted">
            Every pool on Robinhood Chain, live{rate ? ` · ETH ${formatUsd(rate)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="seg" role="tablist" aria-label="Currency">
            <Link href={link(sort, { usd: true })} role="tab" aria-selected={usd} className={`inline-flex h-8 items-center rounded-[9px] px-3 text-[13px] font-semibold ${usd ? 'bg-bg text-ink shadow-[var(--shadow)]' : 'text-muted'}`}>
              USD
            </Link>
            <Link href={link(sort, { usd: false })} role="tab" aria-selected={!usd} className={`inline-flex h-8 items-center rounded-[9px] px-3 text-[13px] font-semibold ${!usd ? 'bg-bg text-ink shadow-[var(--shadow)]' : 'text-muted'}`}>
              ETH
            </Link>
          </div>
          <Link href={link(sort, { safe: !safe })} className={`pill ${safe ? 'pill-up' : ''}`} title="Hide unverified pools and depth under 3 ETH">
            {safe ? '● Rug filter on' : '○ Rug filter off'}
          </Link>
        </div>
      </div>

      <div className="rise rise-2 flex flex-wrap gap-1">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={link(s.key)}
            className={`chip ${sort === s.key ? 'chip-active' : ''}`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card mx-auto my-16 max-w-md p-8 text-center">
          <div className="pill pill-warn mb-3">no data yet</div>
          <p className="text-muted">The indexer hasn&rsquo;t swept the chain yet. Run:</p>
          <pre className="card-flat mt-3 overflow-x-auto p-3 text-left text-[13px]">pnpm --filter @paperhands/indexer dev</pre>
        </div>
      ) : (
        <div className="card rise rise-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Price</th>
                  <th>Traction</th>
                  <th className="hidden md:table-cell">Vol 24h</th>
                  <th className="hidden md:table-cell">5m</th>
                  <th>30m</th>
                  <th className="hidden md:table-cell">Trades</th>
                  <th className="hidden md:table-cell">Depth</th>
                  <th className="hidden md:table-cell">Pool</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const depthQuote = quoteDepth(r)
                  const depthEth = r.quote_symbol === 'USDG' ? (rate ? depthQuote / rate : 0) : depthQuote
                  return (
                    <tr key={r.baseAddr}>
                      <td>
                        <Link href={`/t/${r.address}`} className="flex items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-3 text-[12px] font-bold text-muted">
                            {r.baseSymbol.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold leading-tight">{r.baseSymbol}</span>
                            <span className="block max-w-28 truncate text-[12px] text-muted md:max-w-44">
                              {r.baseName}
                              {r.poolCount > 1 ? ` · ${r.poolCount} pools` : ''}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>{price(r)}</td>
                      <td>
                        <Traction vol30={r.vol30} vol30prev={r.vol30prev} />
                      </td>
                      <td className="hidden md:table-cell">{money(r.vol24, r.quote_symbol)}</td>
                      <td className="hidden md:table-cell">
                        <Change value={pctChange(r.lastClose, r.close5m)} />
                      </td>
                      <td>
                        <Change value={pctChange(r.lastClose, r.close30m)} />
                      </td>
                      <td className="hidden text-muted md:table-cell">{r.trades24.toLocaleString('en-US')}</td>
                      <td className={`hidden md:table-cell ${depthEth < 5 ? 'text-down' : depthEth < 25 ? 'text-muted' : ''}`}>{money(depthQuote, r.quote_symbol)}</td>
                      <td className="hidden md:table-cell">
                        <span className="pill">
                          {r.address.length === 66 ? 'v4' : 'v3'} · {(r.fee / 10_000).toFixed(2)}%
                        </span>
                        {!r.factory_verified && <span className="pill pill-warn ml-1">unverified</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-[12px] text-faint">
        Traction is volume over the last 30 minutes versus the 30 before — the one signal a rug can&rsquo;t fake for free.
        Depth is in-range quote-side liquidity; thin depth means your exit is a rumor. One row per token; the deepest pool is the face.
      </p>
    </div>
  )
}
