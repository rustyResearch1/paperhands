import Link from 'next/link'
import LaunchFeed from '@/components/LaunchFeed'
import PageHeader from '@/components/PageHeader'
import { formatUsd } from '@/lib/format'
import { launchTotals } from '@/lib/launches'
import { ethUsdRate } from '@/lib/usd'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Launches' }

/**
 * The PONS launchpad, read from our own ledger: every launch, its curve's
 * fill, and who is buying — before graduation, where the swap indexers of the
 * world are blind.
 */
export default async function LaunchesPage({ searchParams }: { searchParams: Promise<{ feed?: string }> }) {
  const { feed } = await searchParams
  const initial = (['new', 'trending', 'graduating', 'graduated'] as const).find((f) => f === feed) ?? 'new'
  const rate = ethUsdRate()
  const stats = launchTotals()
  const gradRate = stats.launches > 0 ? (stats.graduated / stats.launches) * 100 : null
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Launchpad"
        title="Launches"
        lede={
          <>
            Every PONS launch as it happens, priced on its bonding curve with the curve&rsquo;s own maths. Buyers are named from the
            curve&rsquo;s events, not guessed. When a curve fills, the launch graduates into a locked Uniswap v4 pool and its page
            follows it there.
          </>
        }
        aside={
          <Link href="/how" className="text-[13px] text-pen hover:underline">
            How the curve works
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Launches seen" value={stats.launches.toLocaleString()} />
        <Stat label="Graduated" value={stats.graduated.toLocaleString()} sub={gradRate !== null ? `${gradRate.toFixed(1)}% of launches` : undefined} />
        <Stat label="Curve trades" value={stats.trades.toLocaleString()} />
        <Stat label="Wallets on curves" value={stats.traders.toLocaleString()} />
        <Stat label="Put into curves" value={stats.inUsd > 0 ? formatUsd(stats.inUsd) : '—'} sub={`${stats.quotes.map((q) => `${q.symbol} ${q.launches}`).slice(0, 4).join(' · ')}`} />
      </div>
      <LaunchFeed ethUsd={rate} initial={initial} />
      <p className="text-[12px] text-faint">
        Launches are quoted in ETH, in USDG, or in a tokenized stock — the Quote column says which, and every amount on the row is in that
        token, priced into dollars from our own ledger where we can. Curve = the share of the graduation threshold sitting in the curve after
        fees and taxes. Mcap = the full launch supply at the last curve price. Deployer &ldquo;5L · 0G&rdquo; means five launches, none graduated — a serial launcher
        with no finishes is a signal, not a verdict. Everything before our first indexed block is missing by construction.
      </p>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-flat p-4">
      <div className="label">{label}</div>
      <div className="num mt-1 text-[18px] font-semibold">{value}</div>
      {sub && <div className="text-[11.5px] text-faint">{sub}</div>}
    </div>
  )
}
