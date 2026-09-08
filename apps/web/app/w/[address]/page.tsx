import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReplayLab from '@/components/ReplayLab'
import TailForm from '@/components/TailForm'
import { db } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { getOrCreateUser } from '@/lib/session'
import { walletPools, walletRecentSwaps } from '@/lib/wire'
import { EXPLORER_URL } from '@paperhands/chain'

export const dynamic = 'force-dynamic'

const fmt = (n: number, d = 3) => n.toLocaleString('en-US', { maximumFractionDigits: d })

export default async function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params
  const address = raw.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(address)) notFound()

  const user = await getOrCreateUser()
  const pools = walletPools(address)
  const swaps = walletRecentSwaps(address)
  const tail = db
    .prepare('SELECT size_quote, active FROM kol_tails WHERE user_id = ? AND wallet = ?')
    .get(user.id, address) as { size_quote: string; active: number } | undefined

  const ethIn = pools.reduce((a, p) => a + p.ethIn, 0)
  const ethOut = pools.reduce((a, p) => a + p.ethOut, 0)
  const openMark = pools.reduce((a, p) => a + (p.netBaseRaw > 0 && p.close ? (p.netBaseRaw / 10 ** p.decimals) * p.close : 0), 0)
  const flow = ethOut - ethIn

  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-bg-3 text-[13px] font-bold text-muted">0x</span>
          <div>
            <h1 className="num text-[20px] font-semibold tracking-tight">
              {address.slice(0, 10)}…{address.slice(-8)}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-[13px]">
              <a className="pill pill-pen" href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer">
                explorer ↗
              </a>
              {tail?.active ? <span className="pill pill-up">tailing</span> : null}
            </div>
          </div>
        </div>
        <Link href="/wire" className="text-[13px] text-pen hover:underline">
          ← Wire
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="ETH in" value={fmt(ethIn)} />
        <Kpi label="ETH out" value={fmt(ethOut)} />
        <Kpi label="Net flow" value={`${flow >= 0 ? '+' : ''}${fmt(flow)}`} tone={flow >= 0 ? 'up' : 'down'} />
        <Kpi label="Open bags · marked" value={fmt(openMark)} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="card rise rise-2 overflow-hidden">
            <div className="px-5 pt-4">
              <span className="label">By pool · tracked window</span>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Buys</th>
                    <th>Sells</th>
                    <th>ETH in</th>
                    <th>ETH out</th>
                    <th>Flow</th>
                    <th>Still holding</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.map((p) => {
                    const f = p.ethOut - p.ethIn
                    const holding = p.netBaseRaw > 0 && p.close ? (p.netBaseRaw / 10 ** p.decimals) * p.close : 0
                    return (
                      <tr key={p.pool}>
                        <td>
                          <Link href={`/t/${p.pool}`} className="font-semibold hover:text-pen">
                            {p.symbol}
                          </Link>
                        </td>
                        <td className="text-up">{p.buys}</td>
                        <td className="text-down">{p.sells}</td>
                        <td>{fmt(p.ethIn)}</td>
                        <td>{fmt(p.ethOut)}</td>
                        <td className={f >= 0 ? 'text-up font-semibold' : 'text-down font-semibold'}>
                          {f >= 0 ? '+' : ''}
                          {fmt(f)}
                        </td>
                        <td className="text-muted">{holding > 0 ? fmt(holding) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card rise rise-3 overflow-hidden">
            <div className="px-5 pt-4">
              <span className="label">Recent swaps</span>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Token</th>
                    <th>Size (ETH)</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {swaps.map((s, i) => (
                    <tr key={s.tx_hash + i}>
                      <td>
                        <span className={`pill ${s.eth > 0 ? 'pill-up' : 'pill-down'}`}>{s.eth > 0 ? 'buy' : 'sell'}</span>
                      </td>
                      <td>
                        <Link href={`/t/${s.pool}`} className="hover:text-pen">
                          {s.symbol}
                        </Link>
                      </td>
                      <td>{fmt(Math.abs(s.eth), 4)}</td>
                      <td className="text-muted">{timeAgo(s.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            Tailing mirrors this wallet with your size: their buy triggers your fixed-size buy; their sell exits your tailed position. You eat
            your own slippage, not theirs — run the replay first.
          </p>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="card-flat p-4">
      <div className="label">{label}</div>
      <div className={`num mt-1 text-[18px] font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}`}>{value}</div>
    </div>
  )
}
