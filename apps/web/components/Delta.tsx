/**
 * A change, coloured by one rule everywhere. Pages disagreed about this: some
 * muted values inside a dead band, others painted 0.0% green, and null was
 * sometimes an em dash and sometimes a zero.
 */
export default function Delta({
  value,
  digits = 1,
  suffix = '%',
  className = '',
}: {
  value: number | null | undefined
  digits?: number
  suffix?: string
  className?: string
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={`text-faint ${className}`}>—</span>
  // Anything inside a twentieth of a percent is noise, not a move.
  const flat = Math.abs(value) < 0.05
  const tone = flat ? 'text-muted' : value > 0 ? 'text-up' : 'text-down'
  return (
    <span className={`${tone} ${className}`}>
      {!flat && value > 0 ? '+' : ''}
      {value.toFixed(digits)}
      {suffix}
    </span>
  )
}
