'use client'

/**
 * A small line chart for an index series (100 = start). Paper-and-ink: one
 * ink line, a bronze baseline at 100, mono axis labels, no glow.
 */
export default function IndexLine({ points, height = 160, label }: { points: { ts: number; index: number }[]; height?: number; label?: string }) {
  if (points.length < 2) return <div className="text-[13px] text-muted">Not enough price history yet.</div>
  const W = 640
  const H = height
  const padL = 40
  const padR = 8
  const padT = 10
  const padB = 22
  const vals = points.map((p) => p.index)
  const lo = Math.min(100, ...vals)
  const hi = Math.max(100, ...vals)
  const span = Math.max(hi - lo, 1)
  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR)
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.index).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]!
  const up = last.index >= 100
  const ticks = [lo, (lo + hi) / 2, hi]
  const first = points[0]!
  const fmtDay = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label={label ?? 'Basket index'}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-jetbrains)">
            {t.toFixed(0)}
          </text>
        </g>
      ))}
      <line x1={padL} x2={W - padR} y1={y(100)} y2={y(100)} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last.index)} r="3" fill={up ? 'var(--up)' : 'var(--down)'} />
      <text x={padL} y={H - 6} fontSize="10" fill="var(--muted)" fontFamily="var(--font-jetbrains)">
        {fmtDay(first.ts)}
      </text>
      <text x={W - padR} y={H - 6} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-jetbrains)">
        {fmtDay(last.ts)} · {last.index.toFixed(1)}
      </text>
    </svg>
  )
}
