'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { EXPLORER_URL } from '@paperhands/chain'
import { formatPrice, formatUsd, timeAgo } from '@/lib/format'
import Kpi from '@/components/Kpi'

interface Fill {
  block: number
  ts: number
  tx: string
  logIndex: number
  pool: string
  token: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  quote: number
  quoteSymbol: string
  usd: number | null
  price: number | null
  trader: string | null
  rank: number | null
}
interface Stats {
  tip: number
  lagSec: number
  blocksPerSec: number
  fills5m: number
  fillsPerMin: number
  fills24h: number
  buys5m: number
  sells5m: number
  volume24hEth: number
  volume24hUsd: number | null
  biggestBuy: Fill | null
  biggestSell: Fill | null
  trackedWallets: number
}
interface Fresh {
  pool: string
  token: string
  symbol: string
  name: string
  version: number
  hooked: boolean
  fee: number
  quoteSymbol: string
  ageSec: number
  swaps: number
  depthQuote: number
}
interface Close {
  ts: number
  trader: string
  token: string
  pool: string
  symbol: string
  tx: string
  ethOut: number
  costOut: number
  realized: number
  heldSec: number
  untracked: boolean
  usd: number | null
  rank: number | null
}

const fmtQty = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(n < 10 ? 2 : 0))
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const signedUsd = (v: number) => (v < 0 ? `-${formatUsd(-v)}` : `+${formatUsd(v)}`)
const held = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86_400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86_400).toFixed(1)}d`)

/** A short click on new fills — higher for buys, lower for sells. */
function beep(ctx: AudioContext, side: 'buy' | 'sell') {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.frequency.value = side === 'buy' ? 880 : 440
  o.type = 'sine'
  g.gain.value = 0.04
  o.connect(g).connect(ctx.destination)
  o.start()
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
  o.stop(ctx.currentTime + 0.13)
}

/**
 * The Robinhood Chain live tape: every fill as it lands in the ledger,
 * the ranked wallets by default, sized in USD, with fresh pools and the
 * ranked wallets' closed trades alongside. Polls the ledger every 4s; a
 * dedicated RPC makes the ledger itself tick every few seconds.
 */
export default function LiveTape() {
  const [tracked, setTracked] = useState(true)
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all')
  const [minUsd, setMinUsd] = useState(0)
  const [sound, setSound] = useState(false)
  const [fills, setFills] = useState<Fill[]>([])
  const lastBlock = useRef(0)
  const audio = useRef<AudioContext | null>(null)
  const seen = useRef(new Set<string>())

  // Reset the stream when filters change.
  useEffect(() => {
    setFills([])
    lastBlock.current = 0
    seen.current.clear()
  }, [tracked, side, minUsd])

  useEffect(() => {
    let stopped = false
    async function poll() {
      if (stopped) return
      try {
        const q = new URLSearchParams({ limit: '120', tracked: tracked ? '1' : '0' })
        if (side !== 'all') q.set('side', side)
        if (minUsd) q.set('minUsd', String(minUsd))
        if (lastBlock.current) q.set('since', String(lastBlock.current))
        const r = (await (await fetch(`/api/tape?${q}`)).json()) as { fills?: Fill[]; tip?: number }
        const incoming = (r.fills ?? []).filter((f) => !seen.current.has(`${f.tx}:${f.logIndex}`))
        // Advance to the ledger tip whether or not anything matched, so the next poll is a delta.
        if (r.tip) lastBlock.current = Math.max(lastBlock.current, r.tip)
        if (incoming.length) {
          for (const f of incoming) seen.current.add(`${f.tx}:${f.logIndex}`)
          lastBlock.current = Math.max(lastBlock.current, ...incoming.map((f) => f.block))
          setFills((prev) => [...incoming, ...prev].slice(0, 300))
          if (sound && audio.current && lastBlock.current) for (const f of incoming.slice(0, 3)) beep(audio.current, f.side)
        }
      } catch {
        // transient; next poll retries
      }
      if (!stopped) setTimeout(poll, 4000)
    }
    poll()
    return () => {
      stopped = true
    }
  }, [tracked, side, minUsd, sound])

  const stats = useQuery({ queryKey: ['tape', 'stats'], queryFn: async () => (await fetch('/api/tape?stats=1')).json() as Promise<Stats>, refetchInterval: 30_000 })
  const fresh = useQuery({ queryKey: ['tape', 'fresh'], queryFn: async () => (await fetch('/api/tape?fresh=1&limit=16')).json() as Promise<{ pools: Fresh[] }>, refetchInterval: 30_000 })
  const closed = useQuery({ queryKey: ['tape', 'closed'], queryFn: async () => (await fetch('/api/tape?closed=1&limit=60')).json() as Promise<{ closes: Close[]; ts: number | null }>, refetchInterval: 60_000 })
  const s = stats.data

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Tape lag" value={s ? (s.lagSec < 120 ? `${s.lagSec}s` : `${Math.round(s.lagSec / 60)}m`) : '…'} sub={s ? `block ${s.tip.toLocaleString()} · ${s.blocksPerSec.toFixed(1)} blk/s` : ''} tone={s && s.lagSec > 300 ? 'warn' : undefined} />
        <Kpi label="Fills" value={s ? `${Math.round(s.fillsPerMin).toLocaleString()}/min` : '…'} sub={s ? `${s.fills24h.toLocaleString()} in 24h · 5m: ${s.buys5m.toLocaleString()} buys / ${s.sells5m.toLocaleString()} sells` : ''} />
        <Kpi label="24h traded" value={s ? (s.volume24hUsd !== null ? formatUsd(s.volume24hUsd) : `${s.volume24hEth.toFixed(1)} ETH`) : '…'} sub={s ? `${s.volume24hEth.toFixed(1)} ETH across token pools` : ''} />
        <Kpi label="Biggest buy · 1h" value={s?.biggestBuy?.usd ? formatUsd(s.biggestBuy.usd) : '—'} sub={s?.biggestBuy ? `${s.biggestBuy.symbol}${s.biggestBuy.trader ? ` · ${short(s.biggestBuy.trader)}` : ''}` : ''} tone="up" />
        <Kpi label="Biggest sell · 1h" value={s?.biggestSell?.usd ? formatUsd(s.biggestSell.usd) : '—'} sub={s?.biggestSell ? `${s.biggestSell.symbol}${s.biggestSell.trader ? ` · ${short(s.biggestSell.trader)}` : ''}` : ''} tone="down" />
        <Kpi label="Tracked wallets" value={s ? String(s.trackedWallets) : '…'} sub="ranked by realized P&L" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
            <span className="label">Live tape</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button className={`chip h-7 px-2.5 text-[12px] ${tracked ? 'chip-active' : ''}`} onClick={() => setTracked(true)}>
                tracked
              </button>
              <button className={`chip h-7 px-2.5 text-[12px] ${!tracked ? 'chip-active' : ''}`} onClick={() => setTracked(false)}>
                everyone
              </button>
              <span className="mx-1 text-faint">·</span>
              {(['all', 'buy', 'sell'] as const).map((v) => (
                <button key={v} className={`chip h-7 px-2.5 text-[12px] ${side === v ? 'chip-active' : ''}`} onClick={() => setSide(v)}>
                  {v === 'all' ? 'all' : v === 'buy' ? 'buys' : 'sells'}
                </button>
              ))}
              <span className="mx-1 text-faint">·</span>
              {[0, 100, 1000, 10_000].map((v) => (
                <button key={v} className={`chip h-7 px-2.5 text-[12px] ${minUsd === v ? 'chip-active' : ''}`} onClick={() => setMinUsd(v)}>
                  {v === 0 ? 'any size' : `≥ $${v.toLocaleString()}`}
                </button>
              ))}
              <span className="mx-1 text-faint">·</span>
              <button
                className={`chip h-7 px-2.5 text-[12px] ${sound ? 'chip-active' : ''}`}
                onClick={() => {
                  if (!audio.current) audio.current = new AudioContext()
                  setSound((v) => !v)
                }}
              >
                sound {sound ? 'on' : 'off'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto pt-2">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th className="txt">Side</th>
                  <th className="txt">Token</th>
                  <th>Size</th>
                  <th className="hidden xl:table-cell">Qty</th>
                  <th className="hidden 2xl:table-cell">Price</th>
                  <th className="txt">Wallet</th>
                  <th className="hidden md:table-cell">Tx</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f) => (
                  <tr key={`${f.tx}:${f.logIndex}`} className="rise">
                    <td className="text-muted">{timeAgo(f.ts)}</td>
                    <td className="txt">
                      <span className={`pill ${f.side === 'buy' ? 'pill-up' : 'pill-down'}`}>{f.side}</span>
                    </td>
                    <td className="txt">
                      <Link href={`/t/${f.pool}`} className="font-semibold hover:text-pen">
                        {f.symbol}
                      </Link>
                    </td>
                    <td className={`font-semibold ${f.side === 'buy' ? 'text-up' : 'text-down'}`}>
                      {f.usd !== null ? formatUsd(f.usd) : `${f.quote.toFixed(3)} ${f.quoteSymbol}`}
                      {f.usd !== null && <span className="ml-1 text-[11px] text-faint">{f.quote.toFixed(f.quoteSymbol === 'ETH' ? 3 : 0)} {f.quoteSymbol}</span>}
                    </td>
                    <td className="hidden text-muted xl:table-cell">{fmtQty(f.qty)}</td>
                    <td className="hidden text-muted 2xl:table-cell">{f.price !== null ? `${formatPrice(f.price)} ETH` : '—'}</td>
                    <td className="txt num">
                      {f.trader ? (
                        <Link href={`/w/${f.trader}`} className="hover:text-pen">
                          {short(f.trader)}
                          {f.rank !== null && <span className="ml-1 pill pill-up">#{f.rank}</span>}
                        </Link>
                      ) : (
                        <span className="text-faint">unattributed</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell">
                      <a className="text-pen hover:underline" href={`${EXPLORER_URL}/tx/${f.tx}`} target="_blank" rel="noreferrer">
                        {f.tx.slice(0, 8)}… ↗
                      </a>
                    </td>
                  </tr>
                ))}
                {fills.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-muted">
                      {tracked ? 'Waiting for the tracked wallets to trade… switch to "everyone" for the full chain.' : 'Listening…'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="label">Fresh pools</span>
              <span className="text-[11px] text-faint">newest first</span>
            </div>
            <ul className="divide-y divide-line px-2 pb-2 pt-2 text-[13px]">
              {(fresh.data?.pools ?? []).map((p) => (
                <li key={p.pool} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="min-w-0">
                    <Link href={`/t/${p.pool}`} className="font-semibold hover:text-pen">
                      {p.symbol}
                    </Link>
                    <span className="ml-1 text-[11px] text-faint">
                      v{p.version}
                      {p.hooked ? ' ⚓' : ''} · {p.quoteSymbol}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted">{p.name}</span>
                  </span>
                  <span className="num text-right text-[12px] text-muted">
                    {held(p.ageSec)} old
                    <br />
                    {p.swaps} swaps · {p.depthQuote.toFixed(p.quoteSymbol === 'ETH' ? 2 : 0)} {p.quoteSymbol}
                  </span>
                </li>
              ))}
              {fresh.data && fresh.data.pools.length === 0 && <li className="px-2 py-2 text-muted">No new pools yet.</li>}
            </ul>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="label">Closed trades · tracked</span>
              <span className="text-[11px] text-faint">{closed.data?.ts ? `as of ${timeAgo(closed.data.ts)} ago` : ''}</span>
            </div>
            <ul className="divide-y divide-line px-2 pb-2 pt-2 text-[13px]">
              {(closed.data?.closes ?? []).slice(0, 25).map((c, i) => (
                <li key={`${c.tx}:${c.token}:${c.trader}:${i}`} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="min-w-0">
                    <Link href={`/w/${c.trader}`} className="num hover:text-pen">
                      {short(c.trader)}
                    </Link>
                    {c.rank !== null && <span className="ml-1 pill pill-up">#{c.rank}</span>}
                    <span className="ml-1">
                      sold{' '}
                      <Link href={`/t/${c.pool}`} className="font-semibold hover:text-pen">
                        {c.symbol}
                      </Link>
                    </span>
                    <span className="block text-[11.5px] text-muted">
                      held {held(c.heldSec)} · {c.ethOut.toFixed(3)} ETH out{c.untracked ? ' · cost partly unknown' : ''}
                    </span>
                  </span>
                  <span className={`num text-right text-[12.5px] font-semibold ${c.realized >= 0 ? 'text-up' : 'text-down'}`}>
                    {c.realized >= 0 ? '+' : ''}
                    {c.realized.toFixed(3)} ETH
                    <br />
                    <span className="text-[11px] font-normal text-faint">{c.usd !== null ? `${signedUsd(c.usd)} · ` : ''}{timeAgo(c.ts)} ago</span>
                  </span>
                </li>
              ))}
              {closed.data && closed.data.closes.length === 0 && <li className="px-2 py-2 text-muted">Closed trades appear after the next ranking refresh.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

