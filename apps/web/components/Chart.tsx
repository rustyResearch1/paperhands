'use client'

import { useEffect, useRef } from 'react'
import { createChart, type UTCTimestamp } from 'lightweight-charts'

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

export default function Chart({ pool }: { pool: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const lastTimeRef = useRef(0)

  useEffect(() => {
    if (!ref.current) return
    const up = css('--up') || '#00b86b'
    const down = css('--down') || '#ef4444'
    const line = css('--line') || '#e5e7eb'
    const muted = css('--muted') || '#6b7280'
    const pen = css('--pen') || '#2563eb'

    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: muted,
        fontFamily: "var(--font-plex), 'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: pen, width: 1, style: 3 },
        horzLine: { color: pen, width: 1, style: 3 },
      },
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
    async function poll() {
      if (stopped) return
      try {
        const res = await fetch(`/api/candles?pool=${pool}&from=${lastTimeRef.current}`)
        const rows: Candle[] = await res.json()
        if (rows.length > 0) {
          for (const r of rows) series.update({ ...r, time: r.time as UTCTimestamp })
          lastTimeRef.current = rows[rows.length - 1]!.time - 60
        }
      } catch {
        // transient; next poll retries
      }
      if (!stopped) setTimeout(poll, 5000)
    }
    poll()

    return () => {
      stopped = true
      chart.remove()
    }
  }, [pool])

  return <div ref={ref} className="h-[380px] w-full" />
}
