import Link from 'next/link'
import { notFound } from 'next/navigation'
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
  const openMark = pools.reduce(
    (a, p) => a + (p.netBaseRaw > 0 && p.close ? (p.netBaseRaw / 10 ** p.decimals) * p.close : 0),
    0,
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-lg font-bold tabular-nums">
          {address.slice(0, 10)}…{address.slice(-8)}
        </h1>
        <a className="rule-label text-pen hover:underline" href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer">
          explorer ↗
        </a>
        <Link href="/wire" className="rule-label text-pen hover:underline ml-auto">
          ← the wire
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="slip p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
            <Stat label="eth in" value={fmt(ethIn)} />
            <Stat label="eth out" value={fmt(ethOut)} />
            <Stat label="net flow" value={`${ethOut - ethIn >= 0 ? '+' : ''}${fmt(ethOut - ethIn)}`} tone={ethOut - ethIn >= 0 ? 'up' : 'down'} />
            <Stat label="open bags (marked)" value={fmt(openMark)} />
          </div>

          <div className="slip p-4">
            <div className="rule-label mb-2">by pool — tracked window</div>
            <div className="overflow-x-auto">
              <table className="ledger w-full">
                <thead>
                  <tr>
                    <th>token</th>
                    <th>buys</th>
                    <th>sells</th>
                    <th>eth in</th>
                    <th>eth out</th>
                    <th>flow</th>
                    <th>still holding (marked)</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.map((p) => {
                    const flow = p.ethOut - p.ethIn
                    const holding = p.netBaseRaw > 0 && p.close ? (p.netBaseRaw / 10 ** p.decimals) * p.close : 0
                    return (
                      <tr key={p.pool}>
                        <td>
                          <Link href={`/t/${p.pool}`} className="font-bold hover:underline underline-offset-4">
                            {p.symbol}
                          </Link>
                        </td>
                        <td className="text-up">{p.buys}</td>
                        <td className="text-down">{p.sells}</td>
                        <td>{fmt(p.ethIn)}</td>
                        <td>{fmt(p.ethOut)}</td>
                        <td className={flow >= 0 ? 'text-up font-bold' : 'text-down font-bold'}>
                          {flow >= 0 ? '+' : ''}
                          {fmt(flow)}
                        </td>
                        <td className="text-graphite">{holding > 0 ? fmt(holding) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="slip p-4">
            <div className="rule-label mb-2">recent swaps</div>
            <table className="ledger w-full">
              <thead>
                <tr>
                  <th>side</th>
                  <th>token</th>
                  <th>size (ETH)</th>
                  <th>when</th>
                </tr>
              </thead>
              <tbody>
                {swaps.map((s, i) => (
                  <tr key={s.tx_hash + i}>
                    <td className={s.eth > 0 ? 'text-up' : 'text-down'}>{s.eth > 0 ? 'buy' : 'sell'}</td>
                    <td>
                      <Link href={`/t/${s.pool}`} className="hover:underline underline-offset-4">
                        {s.symbol}
                      </Link>
                    </td>
                    <td>{fmt(Math.abs(s.eth), 4)}</td>
                    <td className="text-graphite">{timeAgo(s.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <TailForm
            wallet={address}
            activeSize={tail?.active ? tail.size_quote : null}
          />
          <p className="rule-label">
            tailing mirrors this wallet with YOUR size through the same honest engine: their buy triggers
            your fixed-size buy; their sell in a pool exits your whole tailed position. fills land as the
            indexer sees their swaps — you eat your own slippage, not theirs.
          </p>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div>
      <div className="rule-label">{label}</div>
      <div className={`font-bold text-base tabular-nums ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}`}>
        {value}
      </div>
    </div>
  )
}
