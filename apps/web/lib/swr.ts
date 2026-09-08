/**
 * Stale-while-revalidate for expensive server computations. A fresh value is
 * returned as-is; a stale one is returned immediately while one refresh runs
 * in the background; only a cold key makes the caller wait. Concurrent
 * callers share the same in-flight promise.
 */
interface Entry {
  at: number
  value: unknown
  inflight: Promise<unknown> | null
}

// Held on globalThis: Next bundles instrumentation and page routes separately, so a plain
// module-level map would give the boot warm-up its own copy that no page ever reads.
const g = globalThis as { __phswr?: Map<string, Entry> }
const entries = (g.__phswr ??= new Map<string, Entry>())

export function swr<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  let e = entries.get(key)
  if (e && e.at > 0 && Date.now() - e.at < ttlMs) return Promise.resolve(e.value as T)
  if (!e) {
    e = { at: 0, value: undefined, inflight: null }
    entries.set(key, e)
  }
  const entry = e
  if (!entry.inflight) {
    entry.inflight = fn()
      .then((v) => {
        entry.value = v
        entry.at = Date.now()
        return v
      })
      .finally(() => {
        entry.inflight = null
      })
  }
  if (entry.at > 0) {
    // Stale: serve what we have, let the refresh land for the next caller.
    entry.inflight.catch(() => {})
    return Promise.resolve(entry.value as T)
  }
  return entry.inflight as Promise<T>
}

/** Age of the cached value in ms, or null when cold. */
export function swrAge(key: string): number | null {
  const e = entries.get(key)
  return e && e.at > 0 ? Date.now() - e.at : null
}
