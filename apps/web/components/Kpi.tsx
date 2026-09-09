/**
 * One stat, one shape. Six near-identical copies of this lived across the
 * pages, each with slightly different padding and type size, which is why the
 * KPI strips never lined up between Wallet, Tape and Baskets.
 */
export type KpiTone = 'up' | 'down' | 'warn' | 'pen'

const TONE: Record<KpiTone, string> = {
  up: 'text-up',
  down: 'text-down',
  warn: 'text-warn',
  pen: 'text-pen',
}

export default function Kpi({
  label,
  value,
  sub,
  tone,
  hero = false,
  title,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: KpiTone
  /** The one number a page leads with. */
  hero?: boolean
  title?: string
}) {
  return (
    <div className="card-flat p-4" title={title}>
      <div className="label">{label}</div>
      <div className={`num mt-1 font-semibold ${hero ? 'text-[24px]' : 'text-[18px]'} ${tone ? TONE[tone] : ''}`}>{value}</div>
      {sub !== undefined && sub !== null && sub !== '' && <div className="mt-0.5 truncate text-[11.5px] text-faint">{sub}</div>}
    </div>
  )
}

/** A label/value line inside a card — the other shape that was copied around. */
export function Row({ label, value, tone, strong }: { label: string; value: React.ReactNode; tone?: KpiTone; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[13px] text-muted">{label}</span>
      <span className={`num text-[13.5px] ${strong ? 'font-semibold' : ''} ${tone ? TONE[tone] : ''}`}>{value}</span>
    </div>
  )
}
