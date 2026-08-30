import Link from 'next/link'
import { notFound } from 'next/navigation'
import Chart from '@/components/Chart'
import TradeTicket from '@/components/TradeTicket'
import { db } from '@/lib/db'
import { formatEth, formatPrice, formatQty, timeAgo } from '@/lib/format'
import { poolMeta, ticketQuote } from '@/lib/quote'
import { ethDepth } from '@/lib/screener'
import { getOrCreateUser } from '@/lib/session'
import { EXPLORER_URL } from '@paperhands/chain'

export const dynamic = 'force-dynamic'

interface SwapRow {
  ts: number
  amount0: string
  amount1: string
  trader: string | null
  tx_hash: string
}

export default async function TokenPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool: rawPool } = await params
  const pool = rawPool.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(pool)) notFound()
  const meta = poolMeta(pool)
  if (!meta) notFound()

  const user = await getOrCreateUser()
  const poolRow = db
    .prepare('SELECT last_sqrt_price, last_liquidity, base_is_token0, fee, swap_count FROM pools WHERE address = ?')
    .get(pool) as {
    last_sqrt_price: string | null
    last_liquidity: string | null
    base_is_token0: number
    fee: number
    swap_count: number
  }
  const lastClose = (
    db.prepare('SELECT close FROM candles WHERE pool = ? ORDER BY minute_ts DESC LIMIT 1').get(pool) as
      | { close: number }
      | undefined
  )?.close

  const position = db
    .prepare('SELECT qty, cost_quote, realized_quote FROM positions WHERE user_id = ? AND pool = ?')
    .get(user.id, pool) as { qty: string; cost_quote: string; realized_quote: string } | undefined
  const qty = BigInt(position?.qty ?? '0')

  // The honest number: what the pool would pay to exit this position now.
  let realizable: bigint | null = null
  if (qty > 0n) {
    try {
      realizable = BigInt((await ticketQuote(pool, 'sell', qty)).amountOut)
    } catch {
      realizable = null
    }
  }
  const mark = lastClose && qty > 0n ? (Number(qty) / 10 ** meta.baseDecimals) * lastClose : null
  const cost = BigInt(position?.cost_quote ?? '0')

  const tape = db
    .prepare('SELECT ts, amount0, amount1, trader, tx_hash FROM swaps WHERE pool = ? ORDER BY block DESC, log_index DESC LIMIT 25')
    .all(pool) as SwapRow[]
  const baseIsToken0 = meta.base_is_token0 === 1
  const depth = ethDepth(poolRow)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-bold">{meta.baseSymbol}</h1>
        <span className="text-lg tabular-nums">{formatPrice(lastClose ?? 0)} ETH</span>
        <span className="rule-label">
          fee {(meta.fee / 10000).toFixed(2)}% · depth {depth.toLocaleString('en-US', { maximumFractionDigits: 1 })} ETH ·{' '}
          {poolRow.swap_count.toLocaleString()} swaps tracked
        </span>
        {!meta.factory_verified && <span className="stamp text-stamp text-[10px]">unverified pool</span>}
        <a
          className="rule-label text-pen hover:underline ml-auto"
          href={`${EXPLORER_URL}/address/${pool}`}
          target="_blank"
          rel="noreferrer"
        >
          explorer ↗
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="slip p-2">
            <Chart pool={pool} />
          </div>

          {qty > 0n && (
            <div className="slip p-4">
              <div className="rule-label mb-2">your position</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
                <Cell label="holding" value={`${formatQty(qty, meta.baseDecimals)} ${meta.baseSymbol}`} />
                <Cell label="cost basis" value={`${formatEth(cost)} ETH`} />
                <Cell
                  label="marked value"
                  value={mark !== null ? `${mark.toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH` : '—'}
                  strike
                />
                <Cell
                  label="pool would pay"
                  value={realizable !== null ? `${formatEth(realizable)} ETH` : '—'}
                  hilite
                  tone={realizable !== null && realizable >= cost ? 'up' : 'down'}
                />
              </div>
            </div>
          )}

          <div className="slip p-4">
            <div className="rule-label mb-2">the tape — live swaps in this pool</div>
            <table className="ledger w-full">
              <thead>
                <tr>
                  <th>side</th>
                  <th>size (ETH)</th>
                  <th>trader</th>
                  <th>when</th>
                </tr>
              </thead>
              <tbody>
                {tape.map((s) => {
                  const ethAmt = BigInt(baseIsToken0 ? s.amount1 : s.amount0)
                  const isBuy = ethAmt > 0n // ETH flowed into the pool
                  const abs = ethAmt < 0n ? -ethAmt : ethAmt
                  return (
                    <tr key={s.tx_hash + s.ts}>
                      <td className={isBuy ? 'text-up' : 'text-down'}>{isBuy ? 'buy' : 'sell'}</td>
                      <td>{formatEth(abs)}</td>
                      <td className="text-graphite">
                        {s.trader && s.trader !== '0x' ? (
                          <a className="hover:text-pen" href={`${EXPLORER_URL}/address/${s.trader}`} target="_blank" rel="noreferrer">
                            {s.trader.slice(0, 6)}…{s.trader.slice(-4)}
                          </a>
                        ) : (
                          '…'
                        )}
                      </td>
                      <td className="text-graphite">{timeAgo(s.ts)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <TradeTicket
            pool={pool}
            baseSymbol={meta.baseSymbol}
            baseDecimals={meta.baseDecimals}
            balanceWei={user.balance_quote}
            positionQty={position?.qty ?? '0'}
          />
          <p className="rule-label">
            <Link href="/" className="text-pen hover:underline">
              ← back to the book
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

function Cell({
  label,
  value,
  strike,
  hilite,
  tone,
}: {
  label: string
  value: string
  strike?: boolean
  hilite?: boolean
  tone?: 'up' | 'down'
}) {
  return (
    <div>
      <div className="rule-label">{label}</div>
      <div
        className={`font-bold tabular-nums ${strike ? 'line-through decoration-stamp/70 text-graphite' : ''} ${
          tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''
        }`}
      >
        {hilite ? <span className="hilite">{value}</span> : value}
      </div>
    </div>
  )
}
