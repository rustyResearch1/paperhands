/**
 * Every page opens the same way: a mono kicker, a serif headline, one line of
 * plain-language lede, and optional controls on the right. Before this the app
 * had four different header shapes and one page with no headline at all.
 */
export default function PageHeader({
  kicker,
  title,
  lede,
  aside,
  mono = false,
}: {
  kicker?: string
  title: React.ReactNode
  lede?: React.ReactNode
  aside?: React.ReactNode
  /** Addresses and pool ids read as data, not prose. */
  mono?: boolean
}) {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {kicker && <div className="label">{kicker}</div>}
        <h1 className={`${mono ? 'num text-[22px]' : 'text-[28px]'} font-semibold tracking-tight`}>{title}</h1>
        {lede && <p className="mt-1 max-w-3xl text-muted">{lede}</p>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-3">{aside}</div>}
    </div>
  )
}
