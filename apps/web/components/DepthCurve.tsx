'use client'

import { useQuery } from '@tanstack/react-query'

interface Point {
  eth: number
  priceImpactBps: number
  priceMovePct: number
  fillRatio: number
}
interface Depth {
  points: Point[]
  error?: string
}

/**
 * The impact curve: what a buy or sell of each size actually costs, computed
 * by routing every size through the pool(s). Depth as a curve, not a number.
 */
export default function DepthCurve({ token }: { token: string }) {
  const buy = useQuery({ queryKey: ['depth', token, 'buy'], queryFn: async () => (await fetch(`/api/v1/depth?token=${token}&side=buy`)).json() as Promise<Depth>, staleTime: 30_000 })
  const sell = useQuery({ queryKey: ['depth', token, 'sell'], queryFn: async () => (await fetch(`/api/v1/depth?token=${token}&side=sell`)).json() as Promise<Depth>, staleTime: 30_000 })

  const pb = buy.data?.points ?? []
  const ps = sell.data?.points ?? []
  const all = [...pb, ...ps]
  if (buy.isLoading && sell.isLoading) return <div className="card p-5 text-[13px] text-muted">Measuring the impact curve…</div>
  if (all.length === 0) return null

  const W = 560
  const H = 180
  const padL = 44
  const padB = 26
  const padT = 12
  const xs = all.map((p) => Math.log10(p.eth))
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs, xMin + 0.5)
  const yMax = Math.max(50, ...all.map((p) => p.priceImpactBps))
  const x = (eth: number) => padL + ((Math.log10(eth) - xMin) / (xMax - xMin)) * (W - padL - 8)
  const y = (bps: number) => padT + (1 - Math.min(bps, yMax) / yMax) * (H - padT - padB)
  const line = (pts: Point[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.eth).toFixed(1)},${y(p.priceImpactBps).toFixed(1)}`).join(' ')
  const yTicks = [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax]
  const worst = pb[pb.length - 1]

  return (
    <div className="card p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="label">Impact curve</span>
        <span className="text-[12px] text-muted">
          <span className="mr-3 inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--up)' }} /> buy</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--down)' }} /> sell</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full min-w-[420px]" role="img" aria-label="Price impact by trade size">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-jetbrains)">
                {t >= 100 ? `${(t / 100).toFixed(t >= 1000 ? 0 : 1)}%` : `${t.toFixed(0)}bp`}
              </text>
            </g>
          ))}
          {pb.map((p) => (
            <text key={`x${p.eth}`} x={x(p.eth)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-jetbrains)">
              {p.eth}
            </text>
          ))}
          {pb.length > 1 && <path d={line(pb)} fill="none" stroke="var(--up)" strokeWidth="2" strokeLinejoin="round" />}
          {ps.length > 1 && <path d={line(ps)} fill="none" stroke="var(--down)" strokeWidth="2" strokeLinejoin="round" />}
          {pb.map((p) => (
            <circle key={`b${p.eth}`} cx={x(p.eth)} cy={y(p.priceImpactBps)} r="3" fill="var(--up)" />
          ))}
          {ps.map((p) => (
            <circle key={`s${p.eth}`} cx={x(p.eth)} cy={y(p.priceImpactBps)} r="3" fill="var(--down)" />
          ))}
          <text x={W - 8} y={H - 8} textAnchor="end" fontSize="10" fill="var(--faint)" fontFamily="var(--font-jetbrains)">
            size · ETH
          </text>
        </svg>
      </div>
      {worst && (
        <p className="mt-2 text-[12px] text-muted">
          A {worst.eth} ETH buy costs {worst.priceImpactBps >= 100 ? `${(worst.priceImpactBps / 100).toFixed(1)}%` : `${worst.priceImpactBps.toFixed(0)}bps`} of impact and moves
          the price {worst.priceMovePct >= 0 ? '+' : ''}
          {worst.priceMovePct.toFixed(1)}%{worst.fillRatio < 1 ? ` — and only ${(worst.fillRatio * 100).toFixed(0)}% of it fills` : ''}.
        </p>
      )}
    </div>
  )
}
