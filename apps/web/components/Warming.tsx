/**
 * Shown while a heavy screen is building for the first time after a deploy.
 * Better than a blank table, and far better than making the visitor (and every
 * other request on this single-threaded process) wait for it.
 */
export default function Warming({ what, seconds = 30 }: { what: string; seconds?: number }) {
  return (
    <div className="card p-6">
      <div className="label">Building</div>
      <p className="mt-2 max-w-xl text-[14px]">
        {what} is being put together right now — this happens for a few seconds after a deploy. Reload in about {seconds} seconds and it will be here.
      </p>
      <p className="mt-2 text-[12.5px] text-faint">Nothing is broken, and no other page is waiting on this one.</p>
    </div>
  )
}
