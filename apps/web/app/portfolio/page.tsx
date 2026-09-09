import Link from 'next/link'
import AccountKey from '@/components/AccountKey'
import BackedBaskets from '@/components/BackedBaskets'
import ModeGate from '@/components/ModeGate'
import RealPortfolio from '@/components/RealPortfolio'
import XPaperPortfolio from '@/components/XPaperPortfolio'
import XPortfolio from '@/components/XPortfolio'
import { db } from '@/lib/db'
import { formatEth, formatQty, formatUsd } from '@/lib/format'
import { ethUsdRate } from '@/lib/usd'
import { ticketQuote } from '@/lib/quote'
import { getOrCreateUser } from '@/lib/session'
import Kpi from '@/components/Kpi'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Portfolio' }

interface PosRow {
  pool: string
  qty: string
  cost_quote: string
  realized_quote: string
  baseSymbol: string
  baseDecimals: number
  lastClose: number | null
  quote_symbol: string
}

export default async function Portfolio() {
  const user = await getOrCreateUser()
  const rows = db
    .prepare(
      `SELECT po.pool, po.qty, po.cost_quote, po.realized_quote,
              tb.symbol AS baseSymbol, tb.decimals AS baseDecimals, COALESCE(p.quote_symbol,'WETH') AS quote_symbol,
              (SELECT close FROM candles c WHERE c.pool = po.pool ORDER BY minute_ts DESC LIMIT 1) AS lastClose
       FROM positions po
       JOIN pools p ON p.address = po.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE po.user_id = ? AND (CAST(po.qty AS INTEGER) > 0 OR po.realized_quote != '0')
       ORDER BY po.rowid DESC`,
    )
    .all(user.id) as PosRow[]

  const usdRate = ethUsdRate()
  const open = rows.filter((r) => BigInt(r.qty) > 0n)
  const enriched = await Promise.all(
    open.map(async (r) => {
      let realizable: bigint | null = null
      try {
        realizable = BigInt((await ticketQuote(r.pool, 'sell', BigInt(r.qty))).amountOut)
      } catch {
        realizable = null
      }
      const markQuote = r.lastClose ? (Number(BigInt(r.qty)) / 10 ** r.baseDecimals) * r.lastClose : null
      const mark = markQuote === null ? null : r.quote_symbol === 'USDG' ? (usdRate ? markQuote / usdRate : null) : markQuote
      return { ...r, realizable, mark }
    }),
  )

  const balance = BigInt(user.balance_quote)
  const realizableSum = enriched.reduce((acc, r) => acc + (r.realizable ?? 0n), 0n)
  const equity = balance + realizableSum
  const totalRealized = rows.reduce((acc, r) => acc + BigInt(r.realized_quote), 0n)
  const start = 10n * 10n ** 18n
  const pnl = equity - start
  const pnlPct = (Number(pnl) / Number(start)) * 100
  const closed = rows.filter((r) => BigInt(r.qty) === 0n && BigInt(r.realized_quote) !== 0n)

  const practice = (
    <div className="space-y-5">
      <div className="rise">
        <div className="label">Practice portfolio</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="num text-[40px] font-semibold leading-none tracking-tight">
            {usdRate ? formatUsd((Number(equity) / 1e18) * usdRate) : `${formatEth(equity)} ETH`}
          </span>
          <span className={`num text-[16px] font-semibold ${pnl >= 0n ? 'text-up' : 'text-down'}`}>
            {pnl >= 0n ? '+' : ''}
            {formatEth(pnl)} ETH ({pnlPct >= 0 ? '+' : ''}
            {pnlPct.toFixed(2)}%)
          </span>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          {formatEth(equity)} ETH equity · started with 10 ETH · positions valued at what the pool would pay, not the chart
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Cash" value={`${formatEth(balance, 3)} ETH`} />
        <Kpi label="Positions · pool would pay" value={`${formatEth(realizableSum, 3)} ETH`} hero />
        <Kpi label="Realized" value={`${totalRealized >= 0n ? '+' : ''}${formatEth(totalRealized, 3)} ETH`} tone={totalRealized >= 0n ? 'up' : 'down'} />
        <Kpi label="Open positions" value={String(enriched.length)} />
      </div>

      {enriched.length === 0 && closed.length === 0 ? (
        <div className="card mx-auto my-8 max-w-md p-8 text-center">
          <div className="pill mb-3">nothing yet</div>
          <p className="mb-3 text-muted">No positions. That&rsquo;s either discipline or cowardice.</p>
          <Link href="/" className="btn btn-primary">
            Open the markets
          </Link>
        </div>
      ) : (
        <div className="card rise rise-2 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Holding</th>
                  <th>Cost basis</th>
                  <th>Marked</th>
                  <th>Pool would pay</th>
                  <th>Unrealized</th>
                  <th>Realized</th>
                </tr>
              </thead>
              <tbody>
                {enriched.map((r) => {
                  const cost = BigInt(r.cost_quote)
                  const unreal = r.realizable !== null ? r.realizable - cost : null
                  return (
                    <tr key={r.pool}>
                      <td>
                        <Link href={`/t/${r.pool}`} className="font-semibold hover:text-pen">
                          {r.baseSymbol}
                        </Link>
                      </td>
                      <td>{formatQty(BigInt(r.qty), r.baseDecimals)}</td>
                      <td>{formatEth(cost)}</td>
                      <td className="text-muted line-through decoration-down/60">{r.mark !== null ? r.mark.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}</td>
                      <td className="font-semibold">
                        <span className="hilite">{r.realizable !== null ? formatEth(r.realizable) : '—'}</span>
                      </td>
                      <td className={unreal !== null && unreal >= 0n ? 'text-up font-semibold' : 'text-down font-semibold'}>{unreal !== null ? formatEth(unreal) : '—'}</td>
                      <td className={BigInt(r.realized_quote) >= 0n ? 'text-up' : 'text-down'}>{formatEth(BigInt(r.realized_quote))}</td>
                    </tr>
                  )
                })}
                {closed.map((r) => (
                  <tr key={r.pool} className="opacity-60">
                    <td>
                      <Link href={`/t/${r.pool}`} className="hover:text-pen">
                        {r.baseSymbol}
                      </Link>{' '}
                      <span className="pill">closed</span>
                    </td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td className={BigInt(r.realized_quote) >= 0n ? 'text-up' : 'text-down'}>{formatEth(BigInt(r.realized_quote))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 text-[12px] text-faint">
            Marked is what a price × bags screen would show. <span className="hilite">Pool would pay</span> is a live simulated exit of the whole
            position through actual liquidity. The gap is why people diamond-hand to zero.
          </p>
        </div>
      )}

      <div className="rise rise-3">
        <AccountKey />
      </div>
    </div>
  )

  return (
    <ModeGate
      practice={
        <div className="space-y-5">
          {practice}
          <div className="rise">
            <h2 className="text-[20px] font-semibold tracking-tight">Other chains · paper</h2>
            <p className="text-[13.5px] text-muted">10 paper SOL and 5 paper BNB, filled at the same quotes real orders get.</p>
          </div>
          <BackedBaskets ethUsd={usdRate} />
          <XPaperPortfolio />
        </div>
      }
      real={
        <div className="space-y-5">
          <RealPortfolio usdRate={usdRate} />
          <div className="rise">
            <h2 className="text-[20px] font-semibold tracking-tight">Other chains</h2>
            <p className="text-[13.5px] text-muted">Same rule everywhere: a bag is worth what the venue would pay for all of it, not the chart.</p>
          </div>
          <XPortfolio />
        </div>
      }
    />
  )
}

