import Link from 'next/link'
import { notFound } from 'next/navigation'
import Chart from '@/components/Chart'
import CopyAddress from '@/components/CopyAddress'
import DepthCurve from '@/components/DepthCurve'
import HookCard from '@/components/HookCard'
import LpLab from '@/components/LpLab'
import TradeTicket from '@/components/TradeTicket'
import { db } from '@/lib/db'
import { formatEth, formatPct, formatPrice, formatQty, formatUsd, timeAgo } from '@/lib/format'
import { classifyHook } from '@/lib/hooks'
import { ethUsdRate } from '@/lib/usd'
import { poolMeta, ticketQuote } from '@/lib/quote'
import { quoteDepth } from '@/lib/screener'
import { getOrCreateUser } from '@/lib/session'
import { isTokenizedStock } from '@/lib/stock'
import { poolValidation } from '@/lib/validation'
import { EXPLORER_URL } from '@paperhands/chain'
import Delta from '@/components/Delta'

export const dynamic = 'force-dynamic'

interface SwapRow {
  ts: number
  amount0: string
  amount1: string
  trader: string | null
  tx_hash: string
  log_index: number
}

export default async function TokenPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool: rawPool } = await params
  const pool = rawPool.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(pool) && !/^0x[0-9a-f]{64}$/.test(pool)) notFound()
  const meta = poolMeta(pool)
  const validation = poolValidation(pool)
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
  const now = Math.floor(Date.now() / 1000)
  const lastClose = (
    db.prepare('SELECT close FROM candles WHERE pool = ? ORDER BY minute_ts DESC LIMIT 1').get(pool) as { close: number } | undefined
  )?.close
  const close24h = (
    db.prepare('SELECT close FROM candles WHERE pool = ? AND minute_ts <= ? ORDER BY minute_ts DESC LIMIT 1').get(pool, now - 86400) as
      | { close: number }
      | undefined
  )?.close
  const vol24 = (
    db.prepare('SELECT COALESCE(SUM(vol_quote),0) AS v FROM candles WHERE pool = ? AND minute_ts > ?').get(pool, now - 86400) as { v: number }
  ).v
  const change24 = lastClose && close24h ? ((lastClose - close24h) / close24h) * 100 : null

  const position = db
    .prepare('SELECT qty, cost_quote, realized_quote FROM positions WHERE user_id = ? AND pool = ?')
    .get(user.id, pool) as { qty: string; cost_quote: string; realized_quote: string } | undefined
  const qty = BigInt(position?.qty ?? '0')

  let realizable: bigint | null = null
  if (qty > 0n) {
    try {
      realizable = BigInt((await ticketQuote(pool, 'sell', qty)).amountOut)
    } catch {
      realizable = null
    }
  }
  const usdRate = ethUsdRate()
  const markQuote = lastClose && qty > 0n ? (Number(qty) / 10 ** meta.baseDecimals) * lastClose : null
  const mark = markQuote === null ? null : meta.quoteSymbol === 'USDG' ? (usdRate ? markQuote / usdRate : null) : markQuote
  const cost = BigInt(position?.cost_quote ?? '0')

  const tape = db
    .prepare('SELECT ts, amount0, amount1, trader, tx_hash, log_index FROM swaps WHERE pool = ? ORDER BY block DESC, log_index DESC LIMIT 25')
    .all(pool) as SwapRow[]
  const baseIsToken0 = meta.base_is_token0 === 1
  const depth = quoteDepth({ ...poolRow, quoteDecimals: meta.quoteDecimals })
  const tradable = Boolean(meta.factory_verified)
  const labReady = !meta.hooked && (meta.quoteSymbol === 'WETH' || meta.quoteSymbol === 'ETH')

  const priceUsd =
    lastClose === undefined ? null : meta.quoteSymbol === 'USDG' ? lastClose : usdRate ? lastClose * usdRate : null
  const isV4 = pool.length === 66

  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-bg-3 text-[15px] font-bold text-muted">
            {meta.baseSymbol.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[24px] font-semibold tracking-tight">{meta.baseSymbol}</h1>
              <span className="pill">{isV4 ? 'v4' : 'v3'} · {meta.fee >= 8388608 ? 'dynamic fee' : `${(meta.fee / 10000).toFixed(2)}%`}</span>
              {meta.hooked && <span className="pill pill-warn">hook pool</span>}
              {!meta.factory_verified && <span className="pill pill-down">unverified</span>}
              {validation && !validation.error && validation.swaps >= 20 && (
                <span
                  className={`pill ${validation.exactOutRate >= 0.97 ? 'pill-up' : 'pill-warn'}`}
                  title={`Engine replayed the last ${validation.swaps} recorded swaps of this pool through reconstructed state: ${(validation.exactOutRate * 100).toFixed(1)}% reproduced the on-chain output wei-for-wei, ${(validation.exactPriceRate * 100).toFixed(1)}% the post-swap price. Run ${timeAgo(validation.ranAt)} ago.`}
                >
                  engine-verified {(validation.exactOutRate * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="num text-[30px] font-semibold leading-none">
                {priceUsd !== null ? formatUsd(priceUsd) : '—'}
              </span>
              {change24 !== null && (
                <span className="num text-[15px] font-semibold">
                  <Delta value={change24} /> 24h
                </span>
              )}
              <span className="num text-[13px] text-muted">
                {formatPrice(lastClose ?? 0)} {meta.quoteSymbol}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <CopyAddress address={meta.baseAddress} label="CA" />
          <span className="pill">depth {depth.toLocaleString('en-US', { maximumFractionDigits: 1 })} {meta.quoteSymbol}</span>
          <span className="pill">vol 24h {vol24.toLocaleString('en-US', { maximumFractionDigits: 1 })} {meta.quoteSymbol}</span>
          <span className="pill">{poolRow.swap_count.toLocaleString()} swaps</span>
          {!isV4 && (
            <a className="pill pill-pen" href={`${EXPLORER_URL}/address/${pool}`} target="_blank" rel="noreferrer">
              explorer ↗
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="card rise rise-2 p-2">
            <Chart pool={pool} />
          </div>

          <div className="rise rise-2">
            <DepthCurve token={meta.baseAddress} />
          </div>

          {qty > 0n && (
            <div className="card rise rise-2 p-5">
              <div className="label mb-3">Your position</div>
              <div className="grid grid-cols-2 gap-4 text-[13.5px] sm:grid-cols-4">
                <Cell label="Holding" value={`${formatQty(qty, meta.baseDecimals)} ${meta.baseSymbol}`} />
                <Cell label="Cost basis" value={`${formatEth(cost)} ETH`} />
                <Cell label="Marked value" value={mark !== null ? `${mark.toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH` : '—'} strike />
                <Cell
                  label="Pool would pay"
                  value={realizable !== null ? `${formatEth(realizable)} ETH` : '—'}
                  tone={realizable !== null && realizable >= cost ? 'up' : 'down'}
                  hero
                />
              </div>
            </div>
          )}

          <div className="card rise rise-3 overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4">
              <span className="label">Live tape</span>
              <span className="text-[12px] text-faint">latest 25 swaps in this pool</span>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Size ({meta.quoteSymbol})</th>
                    <th>Trader</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {tape.map((s) => {
                    const ethAmt = BigInt(baseIsToken0 ? s.amount1 : s.amount0)
                    const isBuy = ethAmt > 0n
                    const abs = ethAmt < 0n ? -ethAmt : ethAmt
                    return (
                      <tr key={`${s.tx_hash}:${s.log_index}`}>
                        <td>
                          <span className={`pill ${isBuy ? 'pill-up' : 'pill-down'}`}>{isBuy ? 'buy' : 'sell'}</span>
                        </td>
                        <td>{formatQty(abs, meta.quoteDecimals)}</td>
                        <td className="text-muted">
                          {s.trader && s.trader !== '0x' ? (
                            <Link className="hover:text-pen" href={`/w/${s.trader}`}>
                              {s.trader.slice(0, 6)}…{s.trader.slice(-4)}
                            </Link>
                          ) : (
                            '…'
                          )}
                        </td>
                        <td className="text-muted">{timeAgo(s.ts)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {tradable ? (
            <>
              <div className="rise rise-2">
                <TradeTicket
                  pool={pool}
                  baseAddress={meta.baseAddress}
                  baseSymbol={meta.baseSymbol}
                  baseDecimals={meta.baseDecimals}
                  balanceWei={user.balance_quote}
                  positionQty={position?.qty ?? '0'}
                  stock={isTokenizedStock(meta.baseName)}
                />
              </div>
              <div className="rise rise-3">
                {labReady ? (
                  <LpLab pool={pool} baseAddress={meta.baseAddress} baseSymbol={meta.baseSymbol} baseDecimals={meta.baseDecimals} />
                ) : meta.hooked && meta.hooks ? (
                  <HookCard hook={classifyHook(meta.hooks, meta.fee)} />
                ) : (
                  <p className="text-[12px] text-faint">LP backtests for USDG-quoted pools are coming — trading routes through them already.</p>
                )}
              </div>
            </>
          ) : (
            <div className="card p-5">
              <span className="pill pill-down mb-2">view only</span>
              <p className="text-[13.5px] text-muted">
                This pool isn&rsquo;t verified against the Uniswap factory — treat as hostile. Charts and the tape stay live.
              </p>
            </div>
          )}
          <Link href="/" className="block text-[13px] text-pen hover:underline">
            ← Markets
          </Link>
        </div>
      </div>
    </div>
  )
}

function Cell({ label, value, strike, hero, tone }: { label: string; value: string; strike?: boolean; hero?: boolean; tone?: 'up' | 'down' }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={`num mt-1 font-semibold ${hero ? 'text-[18px]' : ''} ${strike ? 'text-muted line-through decoration-down/60' : ''} ${
          tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''
        }`}
      >
        {hero ? <span className="hilite">{value}</span> : value}
      </div>
    </div>
  )
}
