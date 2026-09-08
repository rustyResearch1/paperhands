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

export default function TradeTicket({ pool, baseSymbol, baseDecimals, balanceWei, positionQty }: Props) {
  const router = useRouter()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [ethIn, setEthIn] = useState('0.5')
  const [sellPct, setSellPct] = useState(50)
  const [quote, setQuote] = useState<TicketQuote | null>(null)
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
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/quote?pool=${pool}&side=${side}&amount=${amount}`)
        const q = await res.json()
        if (seq.current !== mySeq) return
        if (q.error) setError(q.error)
        else setQuote(q)
      } catch {
        if (seq.current === mySeq) setError('Quote failed — the RPC may be busy. It retries as you type.')
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
        setFilled(side === 'buy' ? `bought ${formatQty(BigInt(r.quote.amountOut), baseDecimals)} ${baseSymbol}` : `sold for ${formatEth(BigInt(r.quote.amountOut))} ETH`)
        setTimeout(() => setFilled(null), 2500)
        router.refresh()
      }
    } catch {
      setError('Trade failed to send. Try again.')
    } finally {
      setPending(false)
    }
  }

  const impactClass = (bps: number) => (bps > 300 ? 'text-down font-bold' : bps > 75 ? 'text-stamp' : 'text-ink')
  const retention = quote?.instantExit ? Number(BigInt(quote.instantExit)) / Number(BigInt(quote.amountIn)) : null

  return (
    <div className="slip relative p-4">
      {filled && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-paper/80">
          <div className="text-center">
            <span className="stamp text-up text-xl px-3 py-1">filled</span>
            <div className="mt-2 text-[12px] text-graphite">{filled}</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="rule-label">order slip</span>
        <span className="stamp text-stamp text-[9px]">simulated</span>
      </div>

      <div className="grid grid-cols-2 gap-0 border-1.5 border-ink mb-4" role="tablist">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className={`py-2 text-[12px] font-bold uppercase tracking-[0.12em] border border-ink transition-colors ${
              side === s ? (s === 'buy' ? 'bg-up text-paper' : 'bg-down text-paper') : 'bg-paper text-graphite hover:text-ink'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {side === 'buy' ? (
        <div>
          <label className="rule-label block mb-1" htmlFor="eth-in">
            spend (paper ETH) — bankroll {formatEth(BigInt(balanceWei))}
          </label>
          <input
            id="eth-in"
            type="text"
            inputMode="decimal"
            value={ethIn}
            onChange={(e) => setEthIn(e.target.value)}
            className="w-full border-2 border-ink bg-paper px-3 py-2 text-lg font-semibold focus:outline-2 focus:outline-pen"
          />
          <div className="flex gap-1 mt-2">
            {BUY_PRESETS.map((p) => (
              <button key={p} onClick={() => setEthIn(p)} className="border border-grid px-2 py-0.5 text-[11px] hover:border-ink">
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <label className="rule-label block mb-1" htmlFor="sell-pct">
            sell {sellPct}% of {formatQty(held, baseDecimals)} {baseSymbol}
          </label>
          <input
            id="sell-pct"
            type="range"
            min={1}
            max={100}
            value={sellPct}
            onChange={(e) => setSellPct(Number(e.target.value))}
            className="w-full accent-pen"
          />
          <div className="flex gap-1 mt-1">
            {SELL_PRESETS.map((p) => (
              <button key={p} onClick={() => setSellPct(p)} className="border border-grid px-2 py-0.5 text-[11px] hover:border-ink">
                {p}%
              </button>
            ))}
          </div>
          {held === 0n && <p className="text-down mt-2 text-[12px]">No position to sell yet.</p>}
        </div>
      )}

      <div className="mt-4 border-t-2 border-dashed border-ink pt-3 space-y-1.5 text-[12px]">
        {quote ? (
          <>
            {quote.route && (
              <Row
                label={quote.route.twoLeg ? 'routed (2 legs)' : 'routed'}
                value={quote.route.label}
                valueClass={quote.route.hooked ? 'text-stamp' : 'text-pen'}
              />
            )}
            <Row label="spot" value={`${formatPrice(quote.spotPrice)} ETH`} />
            <Row label="your fill" value={`${formatPrice(quote.execPrice)} ETH`} />
            <Row label="price impact" value={formatBps(quote.priceImpactBps)} valueClass={impactClass(quote.priceImpactBps)} />
            <Row
              label="moves the pool price"
              value={`${quote.priceMovePct >= 0 ? '+' : ''}${Math.abs(quote.priceMovePct) < 0.005 ? '<0.01' : quote.priceMovePct.toFixed(2)}%`}
              valueClass={
                Math.abs(quote.priceMovePct) > 5
                  ? 'text-down font-bold'
                  : Math.abs(quote.priceMovePct) > 1
                    ? 'text-stamp'
                    : 'text-graphite'
              }
            />
            <Row label="lp fee" value={formatBps(quote.feeBps)} />
            <Row
              label="you receive"
              value={
                side === 'buy'
                  ? `${formatQty(BigInt(quote.amountOut), baseDecimals)} ${baseSymbol}`
                  : `${formatEth(BigInt(quote.amountOut))} ETH`
              }
              strong
            />
            {side === 'buy' && quote.instantExit && retention !== null && (
              <Row
                label="if you sold it right back"
                value={`${formatEth(BigInt(quote.instantExit))} ETH (${(retention * 100).toFixed(1)}%)`}
                valueClass={retention < 0.9 ? 'text-down' : 'text-graphite'}
              />
            )}
            {side === 'buy' && quote.markInflation && quote.markInflation > 1.05 && (
              <p className="pt-1">
                <span className="hilite font-bold">
                  a PnL screen would mark this bag ×{quote.markInflation.toFixed(1)} what the pool pays
                </span>
              </p>
            )}
            {(quote.fillRatio < 1 || quote.exhaustedWindow) && (
              <p className="text-down font-bold pt-1">
                ✗ pool cannot absorb this size ({(quote.fillRatio * 100).toFixed(1)}% fills) — order will be rejected
              </p>
            )}
          </>
        ) : (
          <p className="text-faint">enter a size to see the honest fill…</p>
        )}
        {error && <p className="text-down pt-1">{error}</p>}
      </div>

      <button
        onClick={submit}
        disabled={pending || !quote || rawAmount() <= 0n}
        className={`mt-4 w-full border-2 border-ink py-2.5 text-[13px] font-bold uppercase tracking-[0.14em] shadow-[3px_3px_0_rgba(28,33,39,0.25)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed ${
          side === 'buy' ? 'bg-up text-paper' : 'bg-down text-paper'
        }`}
      >
        {pending ? 'stamping…' : side === 'buy' ? `buy ${baseSymbol}` : `sell ${baseSymbol}`}
      </button>
      <p className="rule-label mt-2 text-center">
        {quote?.route?.hooked
          ? '⚓ hooked pool: quoted by the chain itself (hook logic included), so no post-trade price preview'
          : 'best fill across every venue · executes at live pool state, not your screenshot'}
      </p>
    </div>
  )
}

function Row({ label, value, strong, valueClass }: { label: string; value: string; strong?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-graphite">{label}</span>
      <span className={`${strong ? 'font-bold' : ''} ${valueClass ?? ''} tabular-nums text-right`}>{value}</span>
    </div>
  )
}
