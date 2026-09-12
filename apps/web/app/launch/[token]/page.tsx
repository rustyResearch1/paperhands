import Link from 'next/link'
import { notFound } from 'next/navigation'
import CopyAddress from '@/components/CopyAddress'
import Kpi from '@/components/Kpi'
import LaunchQuote from '@/components/LaunchQuote'
import { LaunchStatus } from '@/components/LaunchFeed'
import PageHeader from '@/components/PageHeader'
import { formatDuration, formatQtyNum, formatUsd, shortAddr, timeAgo } from '@/lib/format'
import { launchDetail } from '@/lib/launches'
import { ethUsdRate } from '@/lib/usd'
import { EXPLORER_URL } from '@paperhands/chain'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const d = launchDetail(token)
  return { title: d ? `${d.launch.symbol} launch` : 'Launch' }
}

export default async function LaunchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params
  const token = raw.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(token)) notFound()
  const d = launchDetail(token)
  if (!d) notFound()
  const { launch: l, trades, holders, deployerLaunches } = d
  const rate = ethUsdRate()
  const qs = l.quoteSymbol
  const usd = (amt: number) => (l.quoteUsd ? ` · ${formatUsd(amt * l.quoteUsd)}` : '')
  const money = (amt: number) => (l.quoteUsd ? formatUsd(amt * l.quoteUsd) : `${amt.toFixed(3)} ${qs}`)
  const thresholdText = l.threshold >= 100 ? l.threshold.toFixed(0) : l.threshold >= 1 ? Number(l.threshold.toPrecision(4)).toString() : l.threshold.toPrecision(3)
  const serial = l.deployerLaunches >= 5 && l.deployerGraduated === 0

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="PONS launch"
        title={
          <>
            {l.symbol} <span className="text-[16px] font-normal text-muted">{l.name}</span>
          </>
        }
        lede={
          <span className="flex flex-wrap items-center gap-2 text-[13px]">
            <LaunchStatus status={l.status} />
            {!l.nativeQuote && (
              <span className="pill pill-warn" title={`this curve is quoted in the ${qs} token, not ETH`}>
                quoted in {qs}
              </span>
            )}
            <CopyAddress address={l.token} label="CA" />
            <span className="text-muted">launched {formatDuration(l.ageSec)} ago</span>
            <span className="text-faint">·</span>
            <span className="text-muted">
              deployer{' '}
              <Link href={`/w/${l.deployer}`} className="num text-pen hover:underline">
                {shortAddr(l.deployer)}
              </Link>{' '}
              <span className={serial ? 'text-down' : 'text-faint'}>
                ({l.deployerLaunches} launches, {l.deployerGraduated} graduated)
              </span>
            </span>
            <a className="pill pill-pen" href={`${EXPLORER_URL}/address/${l.curve}`} target="_blank" rel="noreferrer">
              curve ↗
            </a>
          </span>
        }
        aside={
          <>
            {l.pool && (
              <Link href={`/t/${l.pool}`} className="btn btn-primary btn-sm">
                Trade on Uniswap →
              </Link>
            )}
            <Link href="/launches" className="text-[13px] text-pen hover:underline">
              ← Launches
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Curve filled" value={l.progressPct === null ? '—' : `${l.progressPct.toFixed(1)}%`} sub={`${l.reserve.toFixed(3)} of ${thresholdText} ${qs}`} tone={l.progressPct !== null && l.progressPct >= 80 ? 'up' : undefined} hero />
        <Kpi label="Put in" value={money(l.quoteIn)} sub={l.quoteUsd ? `${l.quoteIn.toFixed(3)} ${qs}` : undefined} />
        <Kpi label="Taken out" value={money(l.quoteOut)} sub={l.quoteUsd ? `${l.quoteOut.toFixed(3)} ${qs}` : undefined} tone={l.quoteOut > l.quoteIn * 0.5 ? 'down' : undefined} />
        <Kpi label="Buys / sells" value={`${l.buys} / ${l.sells}`} sub={`${l.traders} wallets`} />
        <Kpi label="Last 5 min" value={`${l.trades5m}`} sub={`${l.buys5m} buys · ${l.trades5m - l.buys5m} sells`} />
        <Kpi label="Implied mcap" value={l.mcapQuote !== null ? money(l.mcapQuote) : '—'} sub="1B supply at last curve price" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="label">Curve tape</span>
              <span className="text-[11px] text-faint">buyers named from the curve&rsquo;s own events</span>
            </div>
            <div className="overflow-x-auto pt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th className="txt">Side</th>
                    <th className="txt">Wallet</th>
                    <th>{qs}</th>
                    <th className="hidden md:table-cell">Tokens</th>
                    <th className="hidden md:table-cell">Price</th>
                    <th className="hidden lg:table-cell">Fee + tax</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={`${t.tx}:${t.block}:${t.trader}:${t.tokens}`}>
                      <td className="text-muted">{timeAgo(t.ts)}</td>
                      <td className="txt">
                        <span className={`pill ${t.side === 'buy' ? 'pill-up' : 'pill-down'}`}>{t.side}</span>
                      </td>
                      <td className="txt num">
                        <Link href={`/w/${t.trader}`} className="hover:text-pen">
                          {shortAddr(t.trader)}
                        </Link>
                        {t.trader === l.deployer && <span className="ml-1 pill pill-warn">deployer</span>}
                      </td>
                      <td className={t.side === 'buy' ? 'text-up' : 'text-down'}>
                        {t.eth.toFixed(4)}
                        {l.quoteUsd && <span className="ml-1 text-[11px] text-faint">{formatUsd(t.eth * l.quoteUsd)}</span>}
                      </td>
                      <td className="hidden text-muted md:table-cell">{formatQtyNum(t.tokens)}</td>
                      <td className="hidden text-muted md:table-cell">{t.price !== null ? t.price.toExponential(3) : '—'}</td>
                      <td className="hidden text-faint lg:table-cell">{(t.feeEth + t.taxEth).toFixed(5)}</td>
                    </tr>
                  ))}
                  {trades.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-muted">
                        No curve trades recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {deployerLaunches.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-3">
                <span className="label">Same deployer</span>
                <span className="text-[11px] text-faint">{l.deployerLaunches} launches we have seen</span>
              </div>
              <ul className="divide-y divide-line px-2 pb-2 pt-2 text-[13px]">
                {deployerLaunches.map((o) => (
                  <li key={o.token} className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span>
                      <Link href={`/launch/${o.token}`} className="font-semibold hover:text-pen">
                        {o.symbol}
                      </Link>
                      <span className="ml-1.5 text-[11.5px] text-faint">{formatDuration(o.ageSec)} ago</span>
                      <span className="ml-1.5">
                        <LaunchStatus status={o.status} />
                      </span>
                    </span>
                    <span className="num text-right text-[12px] text-muted">
                      {o.progressPct === null ? '—' : `${o.progressPct.toFixed(0)}%`} · {o.quoteIn.toFixed(2)} {o.quoteSymbol} in
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <LaunchQuote token={l.token} symbol={l.symbol} decimals={l.decimals} quoteSymbol={qs} quoteDecimals={l.quoteDecimals} quoteUsd={l.quoteUsd} />

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="label">Biggest bags on the curve</span>
              <span className="text-[11px] text-faint">net of their sells</span>
            </div>
            <ul className="divide-y divide-line px-2 pb-2 pt-2 text-[13px]">
              {holders.map((h) => (
                <li key={h.trader} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="num">
                    <Link href={`/w/${h.trader}`} className="hover:text-pen">
                      {shortAddr(h.trader)}
                    </Link>
                    {h.trader === l.deployer && <span className="ml-1 pill pill-warn">deployer</span>}
                    <span className="block text-[11.5px] text-faint">
                      {h.buys} buys · {h.sells} sells · {h.ethIn.toFixed(3)} {qs} in{h.ethOut > 0 ? ` · ${h.ethOut.toFixed(3)} out` : ''}
                    </span>
                  </span>
                  <span className="num text-right">
                    {formatQtyNum(h.tokens)}
                    <span className="block text-[11px] text-faint">{((h.tokens / 1_000_000_000) * 100).toFixed(2)}% of supply</span>
                  </span>
                </li>
              ))}
              {holders.length === 0 && <li className="px-2 py-2 text-muted">Nobody holds yet.</li>}
            </ul>
          </div>

          <div className="card-flat p-4 text-[12.5px] text-muted">
            <div className="label">What graduation means</div>
            <p className="mt-1">
              When the curve&rsquo;s real reserve reaches {thresholdText} {qs}, the factory sweeps it into a
              permanently locked Uniswap v4 pool under the PONS meme hook. Trading continues there{l.pool ? ', and this page links to it above' : ' and this page will link to it'}.
              {l.status !== 'graduated' && ' Nothing here is a fill on Uniswap yet.'}
            </p>
            {l.quoteUsd && <p className="mt-2">1 {qs}{usd(1)}{rate && !l.nativeQuote ? ` · 1 ETH · ${formatUsd(rate)}` : ''}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
