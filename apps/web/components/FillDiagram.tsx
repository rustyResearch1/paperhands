/**
 * The thesis in one picture: a chart price is a single number at the top of the
 * book, but a real order walks down through liquidity and fills at the average
 * of everything it touches. The gap between the two lines is what this site
 * measures and most tools quietly ignore.
 *
 * Static and illustrative — the real numbers come from the engine on every
 * token page. Drawn once at these coordinates rather than computed, so it
 * renders identically in both themes and costs nothing.
 */
export default function FillDiagram() {
  const W = 640
  const H = 220
  const padL = 46
  const padR = 14
  const padT = 18
  const padB = 34
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  // Steps: each is a slice of liquidity at a worse price than the last.
  const steps = [
    { w: 0.1, p: 1.0 },
    { w: 0.13, p: 0.975 },
    { w: 0.15, p: 0.94 },
    { w: 0.17, p: 0.9 },
    { w: 0.19, p: 0.85 },
    { w: 0.26, p: 0.78 },
  ]
  const lo = 0.7
  const y = (p: number) => padT + (1 - (p - lo) / (1 - lo)) * plotH
  let x = padL
  const bars = steps.map((s) => {
    const w = s.w * plotW
    const bar = { x, w, p: s.p }
    x += w
    return bar
  })
  // Size-weighted average price actually paid.
  const avg = steps.reduce((a, s) => a + s.w * s.p, 0) / steps.reduce((a, s) => a + s.w, 0)

  return (
    <figure className="card p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="A chart price is the first price; a real order fills at the average of every price it walks through.">
        <line x1={padL} x2={W - padR} y1={y(1)} y2={y(1)} stroke="var(--line-2)" strokeWidth="1" strokeDasharray="4 3" />
        <text x={padL} y={y(1) - 7} fontSize="11" fill="var(--muted)" fontFamily="var(--font-mono)">
          chart price
        </text>

        {bars.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={y(b.p)} width={Math.max(1, b.w - 2)} height={y(lo) - y(b.p)} fill="var(--pen-soft)" stroke="var(--pen)" strokeWidth="0.75" />
          </g>
        ))}

        <line x1={padL} x2={W - padR} y1={y(avg)} y2={y(avg)} stroke="var(--down)" strokeWidth="1.8" />
        <text x={W - padR} y={y(avg) - 7} textAnchor="end" fontSize="11" fill="var(--down)" fontFamily="var(--font-mono)">
          what you actually get
        </text>

        <line x1={padL} x2={padL} y1={padT} y2={y(lo)} stroke="var(--line)" strokeWidth="1" />
        <line x1={padL} x2={W - padR} y1={y(lo)} y2={y(lo)} stroke="var(--line)" strokeWidth="1" />
        <text x={padL} y={H - 12} fontSize="11" fill="var(--faint)" fontFamily="var(--font-mono)">
          order size →
        </text>
        <text x={W - padR} y={H - 12} textAnchor="end" fontSize="11" fill="var(--faint)" fontFamily="var(--font-mono)">
          each block = liquidity at a worse price
        </text>
      </svg>
      <figcaption className="mt-2 text-[12.5px] text-muted">
        A quote is not a price. Your order walks down through whatever liquidity exists, and you receive the average of every step it
        touches. The distance between those two lines is the money most tools never show you.
      </figcaption>
    </figure>
  )
}
