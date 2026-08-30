import Link from 'next/link'
import { db } from '@/lib/db'
import { formatEth, formatQty } from '@/lib/format'
import { ticketQuote } from '@/lib/quote'
import { getOrCreateUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface PosRow {
  pool: string
  qty: string
  cost_quote: string
  realized_quote: string
  baseSymbol: string
  baseDecimals: number
  lastClose: number | null
}

export default async function Portfolio() {
  const user = await getOrCreateUser()
  const rows = db
    .prepare(
      `SELECT po.pool, po.qty, po.cost_quote, po.realized_quote,
              tb.symbol AS baseSymbol, tb.decimals AS baseDecimals,
              (SELECT close FROM candles c WHERE c.pool = po.pool ORDER BY minute_ts DESC LIMIT 1) AS lastClose
       FROM positions po
       JOIN pools p ON p.address = po.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE po.user_id = ? AND (CAST(po.qty AS INTEGER) > 0 OR po.realized_quote != '0')
       ORDER BY po.rowid DESC`,
    )
    .all(user.id) as PosRow[]

  const open = rows.filter((r) => BigInt(r.qty) > 0n)
  const enriched = await Promise.all(
    open.map(async (r) => {
      let realizable: bigint | null = null
      try {
        realizable = BigInt((await ticketQuote(r.pool, 'sell', BigInt(r.qty))).amountOut)
      } catch {
        realizable = null
      }
      const mark = r.lastClose ? (Number(BigInt(r.qty)) / 10 ** r.baseDecimals) * r.lastClose : null
      return { ...r, realizable, mark }
    }),
  )

  const balance = BigInt(user.balance_quote)
  const realizableSum = enriched.reduce((acc, r) => acc + (r.realizable ?? 0n), 0n)
  const equity = balance + realizableSum
  const totalRealized = rows.reduce((acc, r) => acc + BigInt(r.realized_quote), 0n)
  const start = 10n * 10n ** 18n

  return (
    <div>
      <h1 className="text-sm font-bold uppercase tracking-[0.14em] mb-4">your ledger</h1>

      <div className="slip p-4 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13px]">
        <div>
          <div className="rule-label">cash</div>
          <div className="font-bold text-base">{formatEth(balance)} ETH</div>
        </div>
        <div>
          <div className="rule-label">positions (pool would pay)</div>
          <div className="font-bold text-base">
            <span className="hilite">{formatEth(realizableSum)} ETH</span>
          </div>
        </div>
        <div>
          <div className="rule-label">equity</div>
          <div className={`font-bold text-base ${equity >= start ? 'text-up' : 'text-down'}`}>{formatEth(equity)} ETH</div>
        </div>
        <div>
          <div className="rule-label">vs 10 ETH start</div>
          <div className={`font-bold text-base ${equity >= start ? 'text-up' : 'text-down'}`}>
            {formatEth(equity - start)} ETH
          </div>
        </div>
      </div>

      {enriched.length === 0 && totalRealized === 0n ? (
        <div className="slip p-8 max-w-md mx-auto my-12 text-center">
          <div className="stamp text-stamp mb-3">blank ledger</div>
          <p className="text-graphite mb-2">You have not taken a single position. That is either discipline or cowardice.</p>
          <Link href="/" className="text-pen hover:underline">
            open the book →
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="ledger w-full">
            <thead>
              <tr>
                <th>token</th>
                <th>holding</th>
                <th>cost basis</th>
                <th>marked value</th>
                <th>pool would pay</th>
                <th>unrealized (honest)</th>
                <th>realized</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((r) => {
                const cost = BigInt(r.cost_quote)
                const unreal = r.realizable !== null ? r.realizable - cost : null
                return (
                  <tr key={r.pool}>
                    <td>
                      <Link href={`/t/${r.pool}`} className="font-bold hover:underline underline-offset-4">
                        {r.baseSymbol}
                      </Link>
                    </td>
                    <td>{formatQty(BigInt(r.qty), r.baseDecimals)}</td>
                    <td>{formatEth(cost)}</td>
                    <td className="text-graphite line-through decoration-stamp/60">
                      {r.mark !== null ? r.mark.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}
                    </td>
                    <td className="font-bold">
                      <span className="hilite">{r.realizable !== null ? formatEth(r.realizable) : '—'}</span>
                    </td>
                    <td className={unreal !== null && unreal >= 0n ? 'text-up font-bold' : 'text-down font-bold'}>
                      {unreal !== null ? formatEth(unreal) : '—'}
                    </td>
                    <td className={BigInt(r.realized_quote) >= 0n ? 'text-up' : 'text-down'}>
                      {formatEth(BigInt(r.realized_quote))}
                    </td>
                  </tr>
                )
              })}
              {rows
                .filter((r) => BigInt(r.qty) === 0n && BigInt(r.realized_quote) !== 0n)
                .map((r) => (
                  <tr key={r.pool} className="opacity-60">
                    <td>
                      <Link href={`/t/${r.pool}`} className="hover:underline underline-offset-4">
                        {r.baseSymbol}
                      </Link>{' '}
                      <span className="rule-label">closed</span>
                    </td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td className={BigInt(r.realized_quote) >= 0n ? 'text-up' : 'text-down'}>
                      {formatEth(BigInt(r.realized_quote))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="rule-label mt-3">
            marked value is what a price×bags screen would tell you. <span className="hilite">pool would pay</span> is a live
            simulated exit of your whole position through the actual liquidity. the gap is why people diamond-hand to zero.
          </p>
        </div>
      )}
    </div>
  )
}
