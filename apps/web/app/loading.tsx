export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-bg-3" />
      <div className="h-4 w-80 animate-pulse rounded bg-bg-3" />
      <div className="card p-5">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-bg-3" style={{ width: `${88 - i * 6}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}
