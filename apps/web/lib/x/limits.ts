/**
 * Two small guards that make quoting safe under concurrent users without a
 * queue system: identical in-flight requests share one computation, and the
 * number of RPC-heavy computations running at once is capped so a burst of
 * visitors degrades to a short wait instead of an RPC rate-limit storm.
 */
const inflight = new Map<string, Promise<unknown>>()

/** Share the result of `fn` with any concurrent caller using the same key. */
export function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

class Semaphore {
  private active = 0
  private queue: (() => void)[] = []
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
  get pending(): number {
    return this.queue.length
  }
}

/** At most this many best-fill computations in flight; the rest wait their turn. */
export const quoteSemaphore = new Semaphore(Number(process.env.PAPERHANDS_QUOTE_CONCURRENCY ?? 8))
