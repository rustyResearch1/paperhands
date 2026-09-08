import Link from 'next/link'
import { notFound } from 'next/navigation'
import CopyAddress from '@/components/CopyAddress'
import { formatUsd, timeAgo } from '@/lib/format'
import { bscWallet, bscWalletAvailable } from '@/lib/x/bscwallet'
import { simplePriceUsd } from '@/lib/x/gecko'

export const dynamic = 'force-dynamic'
const fmt = (n: number, d = 3) => n.toLocaleString('en-US', { maximumFractionDigits: d })
const signed = (n: number, d = 3) => `${n >= 0 ? '+' : ''}${fmt(n, d)}`

export default async function BscWalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params
  const address = raw.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(address)) notFound()

  if (!bscWalletAvailable) {
    return (
      <div className="card mx-auto my-12 max-w-lg p-8 text-center">
        <div className="pill pill-warn mb-3">not configured</div>
        <p className="text-muted">
          BNB Chain wallet history needs a free Etherscan API key. Set <code className="num">ETHERSCAN_API_KEY</code> on the server and this page lights up: swaps, cost basis, realized and
          unrealized P&amp;L in BNB.
        </p>
      </div>
    )
  }

  let w: Awaited<ReturnType<typeof bscWallet>> | null = null
  let error: string | null = null
  try {
    w = await bscWallet(address)
  } catch (e) {
    error = (e as Error).message
  }
  const bnbUsd = (await simplePriceUsd('bsc', ['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c']).catch(() => ({}) as Record<string, number>))['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'] ?? null
  const usd = (bnb: number) => (bnbUsd ? ` · ${formatUsd(bnb * bnbUsd)}` : '')

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
              <span className="pill">BNB Chain</span>
              <CopyAddress address={address} label="copy" />
              <a className="pill pill-pen" href={`https://bscscan.com/address/${address}`} target="_blank" rel="noreferrer">
                bscscan ↗
              </a>
              {w?.firstTs && (
                <span className="text-muted">
                  seen {timeAgo(w.firstTs)} → {w.lastTs ? timeAgo(w.lastTs) : ''} ago
                </span>
              )}
            </div>
          </div>
        </div>
        <Link href="/x/bsc" className="text-[13px] text-pen hover:underline">
          ← BNB Chain markets
        </Link>
      </div>

      {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
      {w && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Realized" value={signed(w.realized)} sub={`BNB${usd(w.realized)}`} tone={w.realized >= 0 ? 'up' : 'down'} />
            <Kpi label="Unrealized · venue would pay" value={w.unrealized === null ? '—' : signed(w.unrealized)} sub={w.unrealized === null ? 'no open bags' : `BNB${usd(w.unrealized)}`} tone={w.unrealized === null ? undefined : w.unrealized >= 0 ? 'up' : 'down'} />
            <Kpi label="Net flow" value={signed(w.netFlow)} sub="BNB out − in" tone={w.netFlow >= 0 ? 'up' : 'down'} />
            <Kpi label="Win rate" value={w.winRate === null ? '—' : `${(w.winRate * 100).toFixed(0)}%`} sub="tokens with sells" />
            <Kpi label="Volume" value={fmt(w.volBnb, 2)} sub={`BNB · ${w.swaps.length} swaps`} />
          </div>

          <div className="card rise rise-2 overflow-hidden">
            <div className="px-5 pt-4">
              <span className="label">Tokens · profit and loss</span>
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
                  </tr>
                </thead>
                <tbody>
                  {w.tokens.map((t) => (
                    <tr key={t.token}>
                      <td>
                        <span className="flex items-center gap-2">
                          <Link href={`/x/bsc/${t.token}`} className="font-semibold hover:text-pen">
                            {t.symbol}
                          </Link>
                          <CopyAddress address={t.token} label="CA" className="!h-6 !px-2 !text-[11px]" />
                          {t.untracked && <span className="pill pill-warn">partial</span>}
                        </span>
                      </td>
                      <td className="text-muted">
                        <span className="text-up">{t.buys}</span>/<span className="text-down">{t.sells}</span>
                      </td>
                      <td className="hidden text-muted md:table-cell">
                        {fmt(t.bnbIn)} / {fmt(t.bnbOut)}
                      </td>
                      <td className={`font-semibold ${t.realized >= 0 ? 'text-up' : 'text-down'}`}>{t.sells ? signed(t.realized) : '—'}</td>
                      <td className="text-muted">
                        {t.openQty > 0 ? (
                          <>
                            {fmt(t.openQty, 0)} {t.symbol}
                            {t.realizableBnb !== null && <span className="hilite ml-1">{fmt(t.realizableBnb)} BNB</span>}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={t.unrealized === null ? 'text-faint' : t.unrealized >= 0 ? 'text-up font-semibold' : 'text-down font-semibold'}>{t.unrealized === null ? (t.openQty > 0 ? 'unquoted' : '—') : signed(t.unrealized)}</td>
                    </tr>
                  ))}
                  {w.tokens.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-muted">
                        No BNB-denominated swaps found for this wallet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card rise rise-3 overflow-hidden">
            <div className="px-5 pt-4">
              <span className="label">Swaps · latest 200</span>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Side</th>
                    <th>Token</th>
                    <th>Qty</th>
                    <th>BNB</th>
                    <th className="hidden md:table-cell">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {w.swaps.map((s, i) => (
                    <tr key={s.tx + i}>
                      <td className="text-muted">{timeAgo(s.ts)} ago</td>
                      <td>
                        <span className={`pill ${s.side === 'buy' ? 'pill-up' : s.side === 'sell' ? 'pill-down' : ''}`}>{s.side}</span>
                      </td>
                      <td className="font-semibold">{s.symbol}</td>
                      <td className="text-muted">{fmt(Number(s.qtyRaw) / 10 ** s.decimals, 0)}</td>
                      <td>{s.bnb ? fmt(s.bnb, 4) : '—'}</td>
                      <td className="hidden md:table-cell">
                        <a className="text-pen hover:underline" href={`https://bscscan.com/tx/${s.tx}`} target="_blank" rel="noreferrer">
                          {s.tx.slice(0, 8)}… ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[12px] text-faint">
            History from Etherscan (BscScan): BNB and WBNB legs paired with token transfers per transaction. Realized uses a pro-rata cost basis; unrealized is what PancakeSwap or KyberSwap would pay for the whole bag now. Token→token swaps are listed but not priced.
          </p>
        </>
      )}
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
