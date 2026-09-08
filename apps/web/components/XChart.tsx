'use client'

import { useEffect, useRef } from 'react'
import { createChart, type UTCTimestamp } from 'lightweight-charts'

interface Candle {
  ts: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

/** USD candles for a pool on Solana / BNB Chain (GeckoTerminal), refreshed every 30s. */
export default function XChart({ chain, pool }: { chain: 'sol' | 'bsc'; pool: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const up = css('--up') || '#00b86b'
    const down = css('--down') || '#ef4444'
    const line = css('--line') || '#e5e7eb'
    const muted = css('--muted') || '#6b7280'
    const pen = css('--pen') || '#2563eb'
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: muted, fontFamily: "var(--font-plex), 'IBM Plex Mono', monospace", fontSize: 11 },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: pen, width: 1, style: 3 }, horzLine: { color: pen, width: 1, style: 3 } },
    })
    const series = chart.addCandlestickSeries({
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      priceFormat: { type: 'price', precision: 10, minMove: 1e-10 },
    })
    let stopped = false
    let first = true
    async function poll() {
      if (stopped) return
      try {
        const res = await fetch(`/api/v1/xcandles?chain=${chain}&pool=${pool}&tf=minute&limit=${first ? 300 : 5}`)
        const j = (await res.json()) as { candles?: Candle[] }
        if (j.candles?.length) {
          const rows = j.candles.map((c) => ({ time: c.ts as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }))
          if (first) {
            series.setData(rows)
            chart.timeScale().fitContent()
            first = false
          } else for (const r of rows) series.update(r)
        }
      } catch {
        // transient
      }
      if (!stopped) setTimeout(poll, 30_000)
    }
    poll()
    return () => {
      stopped = true
      chart.remove()
    }
  }, [chain, pool])

  return <div ref={ref} className="h-[380px] w-full" />
}
