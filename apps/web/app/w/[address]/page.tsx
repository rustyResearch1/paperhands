import Link from 'next/link'
import { notFound } from 'next/navigation'
import CopyAddress from '@/components/CopyAddress'
import ReplayLab from '@/components/ReplayLab'
import { OpenBagsKpi, OpenBagsTable } from '@/components/WalletOpenBags'
import TailForm from '@/components/TailForm'
import { db } from '@/lib/db'
import { formatPrice, formatUsd, timeAgo } from '@/lib/format'
import { getOrCreateUser } from '@/lib/session'
import { ethUsdRate } from '@/lib/usd'
import { walletSummary, walletSwapLines } from '@/lib/walletx'
import { EXPLORER_URL } from '@paperhands/chain'

export const dynamic = 'force-dynamic'

const fmt = (n: number, d = 3) => n.toLocaleString('en-US', { maximumFractionDigits: d })
const signed = (n: number, d = 3) => `${n >= 0 ? '+' : ''}${fmt(n, d)}`

export default async function WalletPage({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<{ page?: string }> }) {
  const { address: raw } = await params
  const { page: pageRaw } = await searchParams
  const address = raw.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(address)) notFound()
  const page = Math.max(1, Number(pageRaw ?? 1) || 1)

  const user = await getOrCreateUser()
  const [w, swaps] = await Promise.all([walletSummary(address), Promise.resolve(walletSwapLines(address, page))])
  const bags = w.tokens.filter((t) => t.openQty > 0).map((t) => ({ token: t.token, pool: t.pool, symbol: t.symbol, decimals: t.decimals, openQtyRaw: t.openQtyRaw, openCost: t.openCost, markEth: t.markEth }))
  const tail = db.prepare('SELECT size_quote, active FROM kol_tails WHERE user_id = ? AND wallet = ?').get(user.id, address) as { size_quote: string; active: number } | undefined
  const rate = ethUsdRate()
  const usd = (eth: number) => (rate ? ` · ${formatUsd(eth * rate)}` : '')
  const pages = Math.max(1, Math.ceil(swaps.total / 60))

  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-bg-3 text-[13px] font-bold text-muted">0x</span>
          <div>
            <h1 className="num text-[20px] font-semibold tracking-tight">
              {address.slice(0, 10)}…{address.slice(-8)}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
              <CopyAddress address={address} label="copy" />
              <a className="pill pill-pen" href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer">
                blockscout ↗
              </a>
              {w.rank !== null && <span className="pill pill-up">#{w.rank} on the Wire</span>}
              {tail?.active ? <span className="pill pill-up">tailing</span> : null}
              {w.firstTs && (
                <span className="text-muted">
                  seen {timeAgo(w.firstTs)} → {w.lastTs ? timeAgo(w.lastTs) : ''} ago
                </span>
              )}
            </div>
          </div>
        </div>
        <Link href="/wire" className="text-[13px] text-pen hover:underline">
          ← Wire
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Realized" value={signed(w.realized)} sub={`ETH${usd(w.realized)}`} tone={w.realized >= 0 ? 'up' : 'down'} />
        <OpenBagsKpi bags={bags} ethUsd={rate} />
        <Kpi label="Net flow" value={signed(w.netFlow)} sub="ETH out − in" tone={w.netFlow >= 0 ? 'up' : 'down'} />
        <Kpi label="Win rate" value={w.winRate === null ? '—' : `${(w.winRate * 100).toFixed(0)}%`} sub={`${w.closedTokens} tokens with sells`} />
        <Kpi label="Volume" value={fmt(w.volEth, 1)} sub={`ETH · ${w.trades} swaps`} />
        <Kpi label="Open bags · marked" value={fmt(w.markOpen, 2)} sub="ETH at the chart price" />
      </div>

      <div className="rise rise-1">
        <OpenBagsTable bags={bags} ethUsd={rate} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="card rise rise-2 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
              <span className="label">Tokens · profit and loss</span>
              <span className="text-[12px] text-faint">cost basis pro rata · attributed swaps in the tracked window</span>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Trades</th>
                    <th className="hidden md:table-cell">In / out</th>
                    <th>Realized</th>
                    <th>Open bag</th>
                    <th>Unrealized</th>
                    <th className="hidden md:table-cell">Avg entry</th>
                  </tr>
                </thead>
                <tbody>
                  {w.tokens.map((t) => (
                    <tr key={t.token}>
                      <td>
                        <span className="flex items-center gap-2">
                          <Link href={`/t/${t.pool}`} className="font-semibold hover:text-pen">
                            {t.symbol}
                          </Link>
                          <CopyAddress address={t.token} label="CA" className="!h-6 !px-2 !text-[11px]" />
                          {t.untracked && (
                            <span className="pill pill-warn" title="Sold more than the ledger saw bought; earlier buys predate the window, so cost is understated">
                              partial
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="text-muted">
                        <span className="text-up">{t.buys}</span>/<span className="text-down">{t.sells}</span>
                      </td>
                      <td className="hidden text-muted md:table-cell">
                        {fmt(t.ethIn)} / {fmt(t.ethOut)}
                      </td>
                      <td className={`font-semibold ${t.realized >= 0 ? 'text-up' : 'text-down'}`}>{t.sells ? signed(t.realized) : '—'}</td>
                      <td className="text-muted">
                        {t.openQty > 0 ? (
                          <>
                            {fmt(t.openQty, 0)} {t.symbol}
                            {t.markEth > 0 ? <span className="ml-1">~{fmt(t.markEth)} ETH marked</span> : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-faint">{t.openQty > 0 ? 'see open bags' : '—'}</td>
                      <td className="hidden text-muted md:table-cell">{t.avgEntry !== null ? `${formatPrice(t.avgEntry)} ETH` : '—'}</td>
                    </tr>
                  ))}
                  {w.tokens.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-muted">
                        No attributed swaps for this wallet in the tracked window yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card rise rise-3 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
              <span className="label">Swaps</span>
              <span className="text-[12px] text-faint">
                {swaps.total.toLocaleString()} attributed · page {page} of {pages}
              </span>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Side</th>
                    <th>Token</th>
                    <th>Qty</th>
                    <th>ETH</th>
                    <th className="hidden md:table-cell">Price</th>
                    <th className="hidden md:table-cell">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {swaps.lines.map((s, i) => (
                    <tr key={s.tx + i}>
                      <td className="text-muted">{timeAgo(s.ts)} ago</td>
                      <td>
                        <span className={`pill ${s.side === 'buy' ? 'pill-up' : 'pill-down'}`}>{s.side}</span>
                      </td>
                      <td>
                        <Link href={`/t/${s.pool}`} className="font-semibold hover:text-pen">
                          {s.symbol}
                        </Link>
                      </td>
                      <td className="text-muted">{fmt(s.qty, 0)}</td>
                      <td>
                        {fmt(s.eth, 4)}
                        {rate ? <span className="ml-1 text-[12px] text-faint">{formatUsd(s.eth * rate)}</span> : null}
                      </td>
                      <td className="hidden text-muted md:table-cell">{s.price !== null ? `${formatPrice(s.price)} ETH` : '—'}</td>
                      <td className="hidden md:table-cell">
                        <a className="text-pen hover:underline" href={`${EXPLORER_URL}/tx/${s.tx}`} target="_blank" rel="noreferrer">
                          {s.tx.slice(0, 8)}… ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between px-5 pb-4 text-[13px]">
                {page > 1 ? (
                  <Link href={`/w/${address}?page=${page - 1}`} className="text-pen hover:underline">
                    ← newer
                  </Link>
                ) : (
                  <span />
                )}
                {page < pages ? (
                  <Link href={`/w/${address}?page=${page + 1}`} className="text-pen hover:underline">
                    older →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rise rise-2">
            <ReplayLab wallet={address} />
          </div>
          <div className="rise rise-3">
            <TailForm wallet={address} activeSize={tail?.active ? tail.size_quote : null} />
          </div>
          <p className="text-[12px] text-faint">
            Realized = ETH taken out of pools minus the pro-rata cost of what was sold. Unrealized = what the best route would pay for the open bag right now, minus its cost. Attribution
            covers the ledger&rsquo;s tracked window; buys older than that show as &ldquo;partial&rdquo;. Stablecoin and WETH legs are excluded from P&amp;L
            {w.stables.length ? ` (${w.stables.map((s) => s.symbol).join(', ')} flows: ${fmt(w.stables.reduce((a, s) => a + s.ethOut - s.ethIn, 0))} ETH net)` : ''}.
          </p>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="card-flat p-4">
      <div className="label">{label}</div>
      <div className={`num mt-1 text-[18px] font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-faint">{sub}</div>}
    </div>
  )
}
