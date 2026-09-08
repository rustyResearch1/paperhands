import { db } from './db'

/**
 * Tiny usage counters (API hits, replays run) — enough to show that the
 * engine is being used, without an analytics vendor. Keys are free-form
 * strings like `api.v1.quote`.
 */
db.exec(`CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`)

const bumpStmt = db.prepare(
  `INSERT INTO counters (key, n, updated_at) VALUES (?, 1, ?)
   ON CONFLICT(key) DO UPDATE SET n = n + 1, updated_at = excluded.updated_at`,
)

export function bump(key: string): void {
  try {
    bumpStmt.run(key, Math.floor(Date.now() / 1000))
  } catch {
    // counters are decoration; never let them fail a request
  }
}

export function counters(prefix = ''): Record<string, number> {
  const rows = db.prepare(`SELECT key, n FROM counters WHERE key LIKE ? ORDER BY key`).all(`${prefix}%`) as { key: string; n: number }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.n]))
}
