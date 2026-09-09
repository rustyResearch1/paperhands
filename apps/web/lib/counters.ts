import { db } from './db'

/**
 * Tiny usage counters (API hits, replays run) — enough to show that the
 * engine is being used, without an analytics vendor. Keys are free-form
 * strings like `api.v1.quote`.
 */
db.exec(`CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`)

const bumpStmt = db.prepare(
  `INSERT INTO counters (key, n, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET n = n + excluded.n, updated_at = excluded.updated_at`,
)

/**
 * Counting happens in memory and is flushed on a timer. Writing per request put
 * a WAL transaction on the hot path of every public endpoint, so a request could
 * block behind the indexer's write lock for as long as that lock was held.
 */
const pending = new Map<string, number>()
const g = globalThis as { __phcounters?: NodeJS.Timeout }

export function bump(key: string): void {
  pending.set(key, (pending.get(key) ?? 0) + 1)
  g.__phcounters ??= setInterval(flushCounters, 30_000).unref()
}

export function flushCounters(): void {
  if (pending.size === 0) return
  const batch = [...pending]
  pending.clear()
  const now = Math.floor(Date.now() / 1000)
  try {
    db.transaction(() => {
      for (const [key, n] of batch) bumpStmt.run(key, n, now)
    })()
  } catch {
    // Counters are decoration: on a locked ledger put them back and try later.
    for (const [key, n] of batch) pending.set(key, (pending.get(key) ?? 0) + n)
  }
}

export function counters(prefix = ''): Record<string, number> {
  const rows = db.prepare(`SELECT key, n FROM counters WHERE key LIKE ? ORDER BY key`).all(`${prefix}%`) as { key: string; n: number }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.n]))
}
