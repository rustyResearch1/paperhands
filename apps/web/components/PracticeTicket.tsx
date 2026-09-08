'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBps, formatEth, formatPrice, formatQty } from '@/lib/format'

interface TicketQuote {
  side: 'buy' | 'sell'
  amountIn: string
  amountOut: string
  feeAmount: string
  fillRatio: number
  exhaustedWindow: boolean
  priceImpactBps: number
  priceMovePct: number
  feeBps: number
  spotPrice: number
  execPrice: number
  instantExit?: string
  markInflation?: number
  block: string
  route?: { label: string; legs: string[]; twoLeg: boolean; hooked: boolean; exact: boolean; version: number }
  error?: string
}

interface Props {
  pool: string
  baseSymbol: string
  baseDecimals: number
  balanceWei: string
  positionQty: string
}

const BUY_PRESETS = ['0.1', '0.5', '1', '5']
const SELL_PRESETS = [25, 50, 75, 100]

/**
 * The order sheet. Every number is an exact simulation through live
 * liquidity, routed across every venue the token has.
 */
export default function TradeTicket({ pool, baseSymbol, baseDecimals, balanceWei, positionQty }: Props) {
  const router = useRouter()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [ethIn, setEthIn] = useState('0.5')
  const [sellPct, setSellPct] = useState(50)
  const [quote, setQuote] = useState<TicketQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filled, setFilled] = useState<string | null>(null)
  const seq = useRef(0)

  const held = BigInt(positionQty || '0')

  const rawAmount = useCallback((): bigint => {
    if (side === 'buy') {
      const v = Number.parseFloat(ethIn)
      if (!Number.isFinite(v) || v <= 0) return 0n
      return BigInt(Math.round(v * 1e6)) * 10n ** 12n
    }
    return (held * BigInt(sellPct)) / 100n
  }, [side, ethIn, sellPct, held])

  useEffect(() => {
    const amount = rawAmount()
    setError(null)
    if (amount <= 0n) {
      setQuote(null)
      return
    }
    const mySeq = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/quote?pool=${pool}&side=${side}&amount=${amount}`)
        const q = await res.json()
        if (seq.current !== mySeq) return
        if (q.error) setError(q.error)
        else setQuote(q)
      } catch {
        if (seq.current === mySeq) setError('Quote failed — the RPC may be busy. It retries as you type.')
      } finally {
        if (seq.current === mySeq) setLoading(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [pool, side, rawAmount])

  async function submit() {
    const amount = rawAmount()
    if (amount <= 0n || pending) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool, side, amount: amount.toString() }),
      })
      const r = await res.json()
      if (!r.ok) {
        setError(r.error)
      } else {
        setFilled(
          side === 'buy'
            ? `Bought ${formatQty(BigInt(r.quote.amountOut), baseDecimals)} ${baseSymbol}`
            : `Sold for ${formatEth(BigInt(r.quote.amountOut))} ETH`,
        )
        setTimeout(() => setFilled(null), 2400)
        router.refresh()
      }
    } catch {
      setError('Trade failed to send. Try again.')
    } finally {
      setPending(false)
    }
  }

  const impactClass = (bps: number) => (bps > 300 ? 'text-down font-semibold' : bps > 75 ? 'text-warn' : '')
  const retention = quote?.instantExit ? Number(BigInt(quote.instantExit)) / Number(BigInt(quote.amountIn)) : null
  const blocked = Boolean(quote && (quote.fillRatio < 1 || quote.exhaustedWindow))

  return (
    <div className="card relative p-5">
      {filled && (
        <div className="absolute inset-0 z-10 grid place-items-center rounded-[var(--radius)] bg-bg/85 backdrop-blur-sm">
          <div className="rise text-center">
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-up text-white text-xl">✓</div>
            <div className="font-semibold">Filled</div>
            <div className="text-[13px] text-muted">{filled}</div>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <span className="label">Order</span>
        <span className="pill">Practice · simulated</span>
      </div>

      <div className="seg mb-4 w-full" role="tablist">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className="flex-1"
            style={side === s ? { color: s === 'buy' ? 'var(--up)' : 'var(--down)' } : undefined}
          >
            {s === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      {side === 'buy' ? (
        <div>
          <label className="label mb-1.5 block" htmlFor="eth-in">
            Spend · bankroll {formatEth(BigInt(balanceWei), 3)} ETH
          </label>
          <div className="relative">
            <input
              id="eth-in"
              type="text"
              inputMode="decimal"
              value={ethIn}
              onChange={(e) => setEthIn(e.target.value)}
              className="field num pr-14"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-muted">ETH</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {BUY_PRESETS.map((p) => (
              <button key={p} onClick={() => setEthIn(p)} className={`chip h-8 px-3 ${ethIn === p ? 'chip-active' : ''}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <label className="label mb-1.5 block" htmlFor="sell-pct">
            Sell {sellPct}% of {formatQty(held, baseDecimals)} {baseSymbol}
          </label>
          <input
            id="sell-pct"
            type="range"
            min={1}
            max={100}
            value={sellPct}
            onChange={(e) => setSellPct(Number(e.target.value))}
            className="w-full accent-[var(--down)]"
          />
          <div className="mt-1 flex gap-1.5">
            {SELL_PRESETS.map((p) => (
              <button key={p} onClick={() => setSellPct(p)} className={`chip h-8 px-3 ${sellPct === p ? 'chip-active' : ''}`}>
                {p}%
              </button>
            ))}
          </div>
          {held === 0n && <p className="mt-2 text-[13px] text-down">No position to sell yet.</p>}
        </div>
      )}

      <div className={`mt-5 space-y-2 border-t border-line pt-4 text-[13.5px] transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {quote ? (
          <>
            {quote.route && (
              <Row
                label={quote.route.twoLeg ? 'Route · 2 legs' : 'Route'}
                value={quote.route.label}
                valueClass={quote.route.hooked ? 'text-warn' : 'text-pen'}
                mono={false}
              />
            )}
            <Row label="Spot" value={`${formatPrice(quote.spotPrice)} ETH`} />
            <Row label="Your fill" value={`${formatPrice(quote.execPrice)} ETH`} />
            <Row label="Price impact" value={formatBps(quote.priceImpactBps)} valueClass={impactClass(quote.priceImpactBps)} />
            <Row
              label="Moves the pool"
              value={`${quote.priceMovePct >= 0 ? '+' : ''}${Math.abs(quote.priceMovePct) < 0.005 ? '<0.01' : quote.priceMovePct.toFixed(2)}%`}
              valueClass={Math.abs(quote.priceMovePct) > 5 ? 'text-down font-semibold' : Math.abs(quote.priceMovePct) > 1 ? 'text-warn' : 'text-muted'}
            />
            <Row label="LP fee" value={formatBps(quote.feeBps)} />
            <Row
              label="You receive"
              value={side === 'buy' ? `${formatQty(BigInt(quote.amountOut), baseDecimals)} ${baseSymbol}` : `${formatEth(BigInt(quote.amountOut))} ETH`}
              strong
            />
            {side === 'buy' && quote.instantExit && retention !== null && (
              <Row
                label="Sold right back"
                value={`${formatEth(BigInt(quote.instantExit))} ETH · ${(retention * 100).toFixed(1)}%`}
                valueClass={retention < 0.9 ? 'text-down' : 'text-muted'}
              />
            )}
            {side === 'buy' && quote.markInflation && quote.markInflation > 1.05 && (
              <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
                A PnL screen would mark this bag at <b>{quote.markInflation.toFixed(1)}×</b> what the pool would pay.
              </p>
            )}
            {blocked && (
              <p className="rounded-xl bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">
                The pool can&rsquo;t absorb this size — only {(quote.fillRatio * 100).toFixed(1)}% fills. Trade smaller.
              </p>
            )}
          </>
        ) : (
          <p className="text-faint">Enter a size to see the honest fill.</p>
        )}
        {error && <p className="rounded-xl bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
      </div>

      <button
        onClick={submit}
        disabled={pending || !quote || blocked || rawAmount() <= 0n}
        className={`btn mt-5 w-full ${side === 'buy' ? 'btn-primary' : 'btn-danger'}`}
      >
        {pending ? 'Placing…' : side === 'buy' ? `Buy ${baseSymbol}` : `Sell ${baseSymbol}`}
      </button>
      <p className="mt-2 text-center text-[12px] text-faint">
        {quote?.route?.hooked
          ? 'Hook pool: quoted by the chain itself, hook logic included.'
          : 'Best fill across every venue · executes at live pool state.'}
      </p>
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  valueClass,
  mono = true,
}: {
  label: string
  value: string
  strong?: boolean
  valueClass?: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={`${mono ? 'num' : ''} text-right ${strong ? 'font-semibold' : ''} ${valueClass ?? ''}`}>{value}</span>
    </div>
  )
}
