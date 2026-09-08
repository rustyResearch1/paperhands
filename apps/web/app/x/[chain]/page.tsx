import Link from 'next/link'
import { notFound } from 'next/navigation'
import XSearch from '@/components/XSearch'
import { formatPct, formatUsd } from '@/lib/format'
import { isXChain } from '@/lib/x'
import { topPools, trendingPools, type GtPool } from '@/lib/x/gecko'
import { CHAIN_LABEL, NATIVE } from '@/lib/x/types'

export const dynamic = 'force-dynamic'

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d })

export default async function XMarkets({ params }: { params: Promise<{ chain: string }> }) {
  const { chain } = await params
  if (!isXChain(chain) || chain === 'rh') notFound()
  const [trending, top] = await Promise.all([trendingPools(chain).catch(() => [] as GtPool[]), topPools(chain).catch(() => [] as GtPool[])])
  // One row per base token; trending first, then the volume leaders.
  const seen = new Set<string>()
  const rows: (GtPool & { trending: boolean })[] = []
  for (const [list, flag] of [
    [trending, true],
    [top, false],
  ] as const) {
    for (const p of list) {
      const key = p.baseToken.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ ...p, trending: flag })
    }
  }

  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{CHAIN_LABEL[chain]}</h1>
          <p className="text-muted">
            Trending and deepest pools. Every quote routes across all of them —{' '}
            {chain === 'sol' ? 'Jupiter over every Solana DEX' : 'PancakeSwap v3 through our exact engine, KyberSwap when it fills better'} — and the ticket shows what selling right back would return.
          </p>
        </div>
        <XSearch chain={chain} />
      </div>

      <div className="card rise rise-2 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Token</th>
                <th>Price</th>
                <th className="hidden md:table-cell">5m</th>
                <th>1h</th>
                <th className="hidden md:table-cell">24h</th>
                <th>Vol 24h</th>
                <th className="hidden md:table-cell">Liquidity</th>
                <th className="hidden md:table-cell">Txns</th>
                <th className="hidden md:table-cell">DEX</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const [baseSym] = p.name.split(' / ')
                return (
                  <tr key={p.address}>
                    <td>
                      <Link href={`/x/${chain}/${p.baseToken}`} className="flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-3 text-[12px] font-bold text-muted">{(baseSym ?? '?').slice(0, 2).toUpperCase()}</span>
                        <span className="min-w-0">
                          <span className="block font-semibold leading-tight">{baseSym}</span>
                          <span className="block max-w-28 truncate text-[12px] text-muted md:max-w-44">
                            {p.name}
                            {p.trending ? ' · trending' : ''}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>{p.priceUsd !== null ? formatUsd(p.priceUsd) : '—'}</td>
                    <td className={`hidden md:table-cell ${p.change.m5 >= 0 ? 'text-up' : 'text-down'}`}>{formatPct(p.change.m5)}</td>
                    <td className={p.change.h1 >= 0 ? 'text-up' : 'text-down'}>{formatPct(p.change.h1)}</td>
                    <td className={`hidden md:table-cell ${p.change.h24 >= 0 ? 'text-up' : 'text-down'}`}>{formatPct(p.change.h24)}</td>
                    <td>{formatUsd(p.volume.h24)}</td>
                    <td className={`hidden md:table-cell ${p.reserveUsd < 20_000 ? 'text-down' : p.reserveUsd < 100_000 ? 'text-muted' : ''}`}>{formatUsd(p.reserveUsd)}</td>
                    <td className="hidden text-muted md:table-cell">
                      <span className="text-up">{fmt(p.txns24.buys)}</span>/<span className="text-down">{fmt(p.txns24.sells)}</span>
                    </td>
                    <td className="hidden text-muted md:table-cell">{p.dex.replace(/-/g, ' ')}</td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-muted">
                    Market data is momentarily unavailable — try again in a few seconds.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-faint">
        Market data: GeckoTerminal. Quotes and execution: {chain === 'sol' ? 'Jupiter' : 'our engine on PancakeSwap v3 + KyberSwap'}. Prices in USD; orders are sized in {NATIVE[chain].symbol}.
      </p>
    </div>
  )
}
