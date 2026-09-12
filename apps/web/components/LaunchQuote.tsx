'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { formatQtyNum, formatUsd } from '@/lib/format'

interface QuoteDto {
  block: number
  graduated: boolean
  reserve: number
  quoteSymbol: string
  quote: { side: 'buy' | 'sell'; amountIn: string; amountOut: string; fee: string; tax: string; snipeTax: string; snipeTaxBps: number; priceImpactBps: number; spotPrice: number; execPrice: number }
  error?: string
}

/**
 * What the curve would actually give you right now, from its own maths on
 * state read at one block: fee, creator tax, the launch-second snipe tax,
 * and the price you really pay versus the curve's spot. The same honesty as
 * the swap ticket, applied to the launchpad.
 */
export default function LaunchQuote({ token, symbol, decimals, quoteSymbol, quoteDecimals, quoteUsd }: { token: string; symbol: string; decimals: number; quoteSymbol: string; quoteDecimals: number; quoteUsd: number | null }) {
  const [eth, setEth] = useState(quoteSymbol === 'ETH' ? '0.1' : quoteSymbol === 'USDG' ? '100' : '1')
  const q = useQuery({
    queryKey: ['launchquote', token, eth],
    queryFn: async () => (await fetch(`/api/launches?token=${token}&quote=buy&amount=${encodeURIComponent(eth)}`)).json() as Promise<QuoteDto>,
    refetchInterval: 15_000,
    enabled: Number(eth) > 0,
  })
  const d = q.data
  const qd = 10 ** quoteDecimals
  const out = d && !d.error ? Number(BigInt(d.quote.amountOut)) / 10 ** decimals : null
  const fee = d && !d.error ? Number(BigInt(d.quote.fee)) / qd : 0
  const tax = d && !d.error ? Number(BigInt(d.quote.tax)) / qd : 0
  const snipe = d && !d.error ? Number(BigInt(d.quote.snipeTax)) / qd : 0
  const usd = (e: number) => (quoteUsd ? ` · ${formatUsd(e * quoteUsd)}` : '')
  const presets = quoteSymbol === 'ETH' ? ['0.05', '0.1', '0.5', '1'] : quoteSymbol === 'USDG' ? ['25', '100', '500', '1000'] : ['0.5', '1', '5', '10']
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="label">Buy on the curve</span>
        {d && !d.error && <span className="text-[11px] text-faint">block {d.block.toLocaleString()}</span>}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input className="input num w-28" inputMode="decimal" value={eth} onChange={(e) => setEth(e.target.value)} aria-label={`${quoteSymbol} to spend`} />
        <span className="text-[13px] text-muted">{quoteSymbol}</span>
        <div className="ml-auto flex gap-1">
          {presets.map((v) => (
            <button key={v} className={`chip h-7 px-2 text-[11.5px] ${eth === v ? 'chip-active' : ''}`} onClick={() => setEth(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
      {d?.error && <p className="mt-3 text-[13px] text-down">{d.error}</p>}
      {d && !d.error && d.graduated && <p className="mt-3 text-[13px] text-muted">This curve has graduated — trade it on its Uniswap pool from the button above.</p>}
      {d && !d.error && !d.graduated && out !== null && (
        <div className="mt-3 space-y-1 text-[13.5px]">
          <div className="flex items-baseline justify-between">
            <span className="text-muted">You get</span>
            <span className="num font-semibold">
              {formatQtyNum(out)} {symbol}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Price paid vs curve spot</span>
            <span className={`num ${d.quote.priceImpactBps > 300 ? 'text-down' : ''}`}>+{(d.quote.priceImpactBps / 100).toFixed(2)}%</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Curve fee</span>
            <span className="num">{fee.toFixed(5)} {quoteSymbol}{usd(fee)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Creator tax</span>
            <span className="num">{tax.toFixed(5)} {quoteSymbol}{usd(tax)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Snipe tax right now</span>
            <span className={`num ${d.quote.snipeTaxBps > 0 ? 'text-down font-semibold' : 'text-up'}`}>
              {d.quote.snipeTaxBps > 0 ? `${(d.quote.snipeTaxBps / 100).toFixed(1)}% · ${snipe.toFixed(4)} ${quoteSymbol}` : 'none'}
            </span>
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-1 text-[12px] text-faint">
            <span>Curve holds {d.reserve.toFixed(3)} {d.quoteSymbol}</span>
            <span>spot {d.quote.spotPrice.toExponential(3)} {d.quoteSymbol}/token</span>
          </div>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-faint">
        Computed with the curve contract&rsquo;s own formula on its reserves at that block. The snipe tax starts at up to 99% in the launch
        second and halves fourteen times over the window — buying inside it is how launches farm snipers.
      </p>
    </div>
  )
}
