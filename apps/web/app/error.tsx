'use client'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto my-16 max-w-md p-8 text-center">
      <div className="pill pill-down mb-3">something broke</div>
      <h2 className="text-[20px] font-semibold">This page hit an error</h2>
      <p className="mt-1 text-[13.5px] text-muted">
        Usually the public RPC rate-limiting a live quote. It clears within a minute.
        {error.digest ? ` (ref ${error.digest})` : ''}
      </p>
      <button onClick={reset} className="btn btn-ghost mt-4">
        Try again
      </button>
    </div>
  )
}
