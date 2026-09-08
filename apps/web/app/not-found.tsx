import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="card mx-auto my-16 max-w-md p-8 text-center">
      <div className="pill mb-3">not found</div>
      <h2 className="text-[20px] font-semibold">No such page</h2>
      <p className="mt-1 text-[13.5px] text-muted">If you pasted a pool or wallet address, check it&rsquo;s a Robinhood Chain address we track.</p>
      <Link href="/" className="btn btn-primary mt-4">
        Back to markets
      </Link>
    </div>
  )
}
