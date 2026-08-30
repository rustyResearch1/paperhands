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

export default function Chart({ pool }: { pool: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const lastTimeRef = useRef(0)

  useEffect(() => {
    if (!ref.current) return
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#6a7178',
        fontFamily: "var(--font-plex), 'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#e7edf3' },
        horzLines: { color: '#e7edf3' },
      },
      rightPriceScale: { borderColor: '#1c2127' },
      timeScale: { borderColor: '#1c2127', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: '#2848b8', width: 1, style: 3 },
        horzLine: { color: '#2848b8', width: 1, style: 3 },
      },
    })
    const series = chart.addCandlestickSeries({
      upColor: '#177244',
      downColor: '#b3362a',
      borderUpColor: '#177244',
      borderDownColor: '#b3362a',
      wickUpColor: '#177244',
      wickDownColor: '#b3362a',
      priceFormat: { type: 'price', precision: 10, minMove: 1e-10 },
    })
    let stopped = false
    async function poll() {
      if (stopped) return
      try {
        const res = await fetch(`/api/candles?pool=${pool}&from=${lastTimeRef.current}`)
        const rows: Candle[] = await res.json()
        if (rows.length > 0) {
          for (const r of rows) {
            series.update({ ...r, time: r.time as UTCTimestamp })
          }
          lastTimeRef.current = rows[rows.length - 1]!.time - 60
        }
      } catch {
        // transient fetch failure; next poll retries
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
