import Link from 'next/link'
import { notFound } from 'next/navigation'
import BscLpCard from '@/components/BscLpCard'
import XChart from '@/components/XChart'
import XTicket from '@/components/XTicket'
import { formatPct, formatUsd } from '@/lib/format'
import { isXChain, validTokenAddress, xtoken } from '@/lib/x'
import { simplePriceUsd, tokenInfo, tokenPools } from '@/lib/x/gecko'
import { CHAIN_LABEL, EXPLORER, NATIVE } from '@/lib/x/types'

export const dynamic = 'force-dynamic'

const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d })

export default async function XTokenPage({ params }: { params: Promise<{ chain: string; token: string }> }) {
  const { chain, token } = await params
  if (!isXChain(chain) || chain === 'rh' || !validTokenAddress(chain, token)) notFound()
  const nativeRef = NATIVE[chain].wrapped ?? NATIVE[chain].address
  const [meta, info, pools, nativePx] = await Promise.all([
    xtoken(chain, token),
    tokenInfo(chain, token).catch(() => null),
    tokenPools(chain, token).catch(() => []),
    simplePriceUsd(chain, [nativeRef]).catch(() => ({}) as Record<string, number>),
  ])
  if (!meta) notFound()
  const nativeUsd = nativePx[nativeRef.toLowerCase()] ?? null
  const top = pools[0]
  const priceUsd = info?.priceUsd ?? top?.priceUsd ?? meta.priceUsd ?? null
  const change24 = top?.change.h24 ?? null
  const vol24 = info?.volume24 ?? pools.reduce((a, p) => a + p.volume.h24, 0)
  const liquidity = info?.reserveUsd ?? pools.reduce((a, p) => a + p.reserveUsd, 0)

  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-bg-3 text-[15px] font-bold text-muted">{meta.symbol.slice(0, 2).toUpperCase()}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[24px] font-semibold tracking-tight">{meta.symbol}</h1>
              <span className="pill">{CHAIN_LABEL[chain]}</span>
              {top && <span className="pill">{top.dex.replace(/-/g, ' ')}</span>}
              <span className="text-[13px] text-muted">{meta.name}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="num text-[30px] font-semibold leading-none">{priceUsd !== null ? formatUsd(priceUsd) : '—'}</span>
              {change24 !== null && <span className={`num text-[15px] font-semibold ${change24 >= 0 ? 'text-up' : 'text-down'}`}>{formatPct(change24)} 24h</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span className="pill">liquidity {formatUsd(liquidity)}</span>
          <span className="pill">vol 24h {formatUsd(vol24)}</span>
          {info?.fdvUsd ? <span className="pill">FDV {formatUsd(info.fdvUsd)}</span> : null}
          <a className="pill pill-pen" href={EXPLORER[chain].token(meta.address)} target="_blank" rel="noreferrer">
            explorer ↗
          </a>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <div className="card rise rise-1 p-3">
            {top ? <XChart chain={chain} pool={top.address} /> : <p className="p-6 text-center text-muted">No pool candles yet.</p>}
            {top && (
              <p className="px-2 pb-1 pt-2 text-[12px] text-faint">
                {top.name} on {top.dex.replace(/-/g, ' ')} · USD · 1m candles
              </p>
            )}
          </div>

          <div className="card rise rise-2 overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4">
              <span className="label">Pools</span>
              <span className="text-[12px] text-faint">where this token trades · fills route across all of them</span>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Pool</th>
                    <th>DEX</th>
                    <th>Liquidity</th>
                    <th>Vol 24h</th>
                    <th className="hidden md:table-cell">Txns 24h</th>
                    <th className="hidden md:table-cell">1h</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.slice(0, 8).map((p) => (
                    <tr key={p.address}>
                      <td className="font-semibold">{p.name}</td>
                      <td className="text-muted">{p.dex.replace(/-/g, ' ')}</td>
                      <td>{formatUsd(p.reserveUsd)}</td>
                      <td>{formatUsd(p.volume.h24)}</td>
                      <td className="hidden text-muted md:table-cell">
                        <span className="text-up">{fmt(p.txns24.buys, 0)}</span> / <span className="text-down">{fmt(p.txns24.sells, 0)}</span>
                      </td>
                      <td className={`hidden md:table-cell ${p.change.h1 >= 0 ? 'text-up' : 'text-down'}`}>{formatPct(p.change.h1)}</td>
                    </tr>
                  ))}
                  {pools.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-muted">
                        No pools indexed for this token yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rise rise-2">
            <XTicket chain={chain} token={{ address: meta.address, symbol: meta.symbol, decimals: meta.decimals }} nativeUsd={nativeUsd} />
          </div>
          {chain === 'bsc' && (
            <div className="rise rise-3">
              <BscLpCard token={meta.address} symbol={meta.symbol} decimals={meta.decimals} />
            </div>
          )}
          <Link href={`/x/${chain}`} className="block text-[13px] text-pen hover:underline">
            ← {CHAIN_LABEL[chain]} markets
          </Link>
        </div>
      </div>
    </div>
  )
}
