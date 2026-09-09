import Link from 'next/link'
import PageHeader from '@/components/PageHeader'
import { backersLeaderboard } from '@/lib/baskets'
import { formatUsd } from '@/lib/format'
import { ethUsdRate } from '@/lib/usd'
import Delta from '@/components/Delta'
import { shortAddr } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Baskets' }

const pct = (n: number | null) => (n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`)

export default async function BasketsPage() {
  const rows = await backersLeaderboard(30)
  const rate = ethUsdRate()
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Social"
        title="Baskets"
        lede={
          <>
          Every profitable wallet on the Wire, as a basket you can hold. Not copy-trading: you don&rsquo;t chase their fills, you hold what they hold, read straight from
          the chain and marked at the last trade. Back one on your practice bankroll today; the on-chain basket token, whose pool fees buy the wallet&rsquo;s bags, is the
            next stage.
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['01', 'Pick a wallet', 'The Wire ranks them by realized profit on a cost basis we replay ourselves.'],
          ['02', 'Hold the basket', 'Their top bags by weight. Priced back through our candles so you see what holding it would have done.'],
          ['03', 'Then the token', 'A Uniswap v4 pool per wallet: swap fees buy the basket, the trader takes fees in the token, sells show on the Tape.'],
        ].map(([n, t, s]) => (
          <div key={n} className="card-flat p-4">
            <div className="num text-[11px] text-faint">{n}</div>
            <div className="mt-1 font-semibold">{t}</div>
            <div className="mt-1 text-[12.5px] text-muted">{s}</div>
          </div>
        ))}
      </div>

      <div className="card rise rise-2 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3">
          <span className="label">Backers leaderboard</span>
          <span className="text-[11px] text-faint">top 30 on the Wire · refreshed every 2 min</span>
        </div>
        <div className="overflow-x-auto pt-2">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th className="txt">Wallet</th>
                <th className="txt">Basket</th>
                <th>Marked</th>
                <th>7d as basket</th>
                <th className="hidden md:table-cell">Realized</th>
                <th className="hidden md:table-cell">Win rate</th>
                <th>Backers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.address}>
                  <td className="text-muted">{r.rank}</td>
                  <td className="txt num">
                    <Link href={`/w/${r.address}/basket`} className="font-semibold hover:text-pen">
                      {shortAddr(r.address)}
                    </Link>
                  </td>
                  <td className="txt">
                    {r.holdings === 0 ? (
                      <span className="text-faint">no marked bags</span>
                    ) : (
                      <>
                        <span className="font-semibold">{r.top.join(' · ')}</span>
                        {r.holdings > 3 && <span className="text-faint"> +{r.holdings - 3}</span>}
                      </>
                    )}
                  </td>
                  <td>
                    {r.markEth.toFixed(2)} ETH
                    {rate && r.markEth > 0 && <span className="ml-1 text-[11px] text-faint">{formatUsd(r.markEth * rate)}</span>}
                  </td>
                  <td>
                    <Delta value={r.return7dPct} />
                  </td>
                  <td className={`hidden md:table-cell ${r.realizedEth >= 0 ? 'text-up' : 'text-down'}`}>
                    {r.realizedEth >= 0 ? '+' : ''}
                    {r.realizedEth.toFixed(2)} ETH
                  </td>
                  <td className="hidden text-muted md:table-cell">{r.winRate === null ? '—' : `${(r.winRate * 100).toFixed(0)}%`}</td>
                  <td>
                    {r.backers}
                    {r.backedEth > 0 && <span className="ml-1 text-[11px] text-faint">{r.backedEth.toFixed(2)} ETH</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted">
                    The Wire hasn&rsquo;t ranked wallets yet. Check back after the next refresh.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-faint">
        &ldquo;7d as basket&rdquo; is today&rsquo;s basket priced back a week, not the trader&rsquo;s own P&amp;L. Marks are last-trade prices from our ledger; the exact
        pool-would-pay valuation lives on each wallet page. Practice balances are not money.
      </p>
    </div>
  )
}
