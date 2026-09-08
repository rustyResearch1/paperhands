import type { ChainClient } from '@paperhands/chain'
import type Database from 'better-sqlite3'
import { getMeta } from './db.js'
import { replayPool } from './history.js'

/**
 * Scheduled self-validation: re-execute a pool's recent recorded swaps through
 * the engine and count exact reproductions of what happened on-chain. The
 * result is what the token page shows as its "engine-verified" badge — a
 * number, not a claim.
 *
 * Reconstruction needs the RPC's pinned state, so this only runs while the
 * watcher is within a few thousand blocks of the head; one pool per call keeps
 * a watch tick short.
 */
const HOOKLESS = '0x0000000000000000000000000000000000000000'

export interface ValidationRow {
  pool: string
  swaps: number
  liq_events: number
  exact_out: number
  exact_price: number
  from_block: number
  to_block: number
  ran_at: number
  error: string | null
}

export function ensureValidations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS validations (
    pool TEXT PRIMARY KEY,
    swaps INTEGER NOT NULL DEFAULT 0,
    liq_events INTEGER NOT NULL DEFAULT 0,
    exact_out INTEGER NOT NULL DEFAULT 0,
    exact_price INTEGER NOT NULL DEFAULT 0,
    from_block INTEGER NOT NULL DEFAULT 0,
    to_block INTEGER NOT NULL DEFAULT 0,
    ran_at INTEGER NOT NULL,
    error TEXT
  )`)
}

export interface ValidateOptions {
  headBlock: bigint
  cursor: bigint
  /** Skip when the cursor trails the head by more than this (pinned state is gone). */
  maxLag?: number
  /** How many of the busiest hookless pools rotate through validation. */
  candidates?: number
  /** Re-validate a pool once its last run is older than this. */
  maxAgeSec?: number
  /** Most recent swaps to replay per run. */
  maxSwaps?: number
  /** Only replay within this many blocks of the cursor (bounds reconstruction cost). */
  windowBlocks?: number
}

/** Validate the next due pool; returns null when nothing is due or reconstruction is impossible. */
export async function validateNextPool(
  client: ChainClient,
  db: Database.Database,
  opts: ValidateOptions,
): Promise<{ pool: string; swaps: number; exactOutRate: number; error?: string } | null> {
  const { headBlock, cursor, maxLag = 2_000, candidates = 8, maxAgeSec = 6 * 3600, maxSwaps = 500, windowBlocks = 100_000 } = opts
  if (Number(headBlock - cursor) > maxLag) return null
  const liqFrom = Number(getMeta(db, 'liq_from') ?? NaN)
  if (Number.isNaN(liqFrom)) return null
  ensureValidations(db)

  const now = Math.floor(Date.now() / 1000)
  const due = db
    .prepare(
      `SELECT p.address AS pool FROM pools p
       LEFT JOIN validations v ON v.pool = p.address
       WHERE p.factory_verified = 1 AND p.base_is_token0 IS NOT NULL AND (p.hooks IS NULL OR p.hooks = ?)
         AND p.swap_count > 50
       ORDER BY p.swap_count DESC LIMIT ?`,
    )
    .all(HOOKLESS, candidates) as { pool: string }[]
  const stale = db.prepare(`SELECT ran_at FROM validations WHERE pool = ?`)
  const target = due.find((c) => {
    const row = stale.get(c.pool) as { ran_at: number } | undefined
    return !row || now - row.ran_at > maxAgeSec
  })
  if (!target) return null

  const floor = Math.max(liqFrom, Number(cursor) - windowBlocks)
  const span = db
    .prepare(
      `SELECT MIN(block) AS lo, MAX(block) AS hi, COUNT(*) AS n FROM
       (SELECT block FROM swaps WHERE pool = ? AND block > ? ORDER BY block DESC LIMIT ?)`,
    )
    .get(target.pool, floor, maxSwaps) as { lo: number | null; hi: number | null; n: number }
  const upsert = db.prepare(
    `INSERT INTO validations (pool, swaps, liq_events, exact_out, exact_price, from_block, to_block, ran_at, error)
     VALUES (@pool, @swaps, @liq, @out, @price, @lo, @hi, @at, @error)
     ON CONFLICT(pool) DO UPDATE SET swaps=excluded.swaps, liq_events=excluded.liq_events, exact_out=excluded.exact_out,
       exact_price=excluded.exact_price, from_block=excluded.from_block, to_block=excluded.to_block, ran_at=excluded.ran_at, error=excluded.error`,
  )
  if (!span.n || span.lo === null || span.hi === null || span.n < 5) {
    upsert.run({ pool: target.pool, swaps: 0, liq: 0, out: 0, price: 0, lo: 0, hi: 0, at: now, error: 'too few recent swaps' })
    return { pool: target.pool, swaps: 0, exactOutRate: 0, error: 'too few recent swaps' }
  }
  try {
    // Start one block before the first swap so it is replayed, not skipped.
    const stats = await replayPool(client, db, target.pool, span.lo - 1, span.hi, { snapToRecorded: true })
    upsert.run({ pool: target.pool, swaps: stats.swaps, liq: stats.liqEvents, out: stats.exactOut, price: stats.exactPrice, lo: span.lo - 1, hi: span.hi, at: now, error: null })
    return { pool: target.pool, swaps: stats.swaps, exactOutRate: stats.swaps > 0 ? stats.exactOut / stats.swaps : 0 }
  } catch (err) {
    const error = (err as Error).message.split('\n')[0]!.slice(0, 200)
    upsert.run({ pool: target.pool, swaps: 0, liq: 0, out: 0, price: 0, lo: span.lo - 1, hi: span.hi, at: now, error })
    return { pool: target.pool, swaps: 0, exactOutRate: 0, error }
  }
}
