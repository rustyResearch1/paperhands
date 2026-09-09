import { db } from './db'
import { storedSnapshot } from './screener'
import { swr } from './swr'

/**
 * Numbers the How-it-works page uses to prove its own claims, read from the
 * same ledger everything else reads. A page that says "our fills are exact"
 * should show its marking, so this reports the self-validation record
 * including the swaps that did NOT match.
 *
 * Every query here is deliberately cheap — no aggregate over the swaps table,
 * which is tens of millions of rows and would stall the whole process.
 */
export interface Proof {
  pools: number
  verifiedPools: number
  v3Pools: number
  v4Pools: number
  hookedPools: number
  tokens: number
  /** Fills recorded in the last 24h, from the watcher's snapshot. */
  fills24h: number
  /** Replay self-validation: real swaps re-executed through our engine. */
  replayedSwaps: number
  exactSwaps: number
  exactPct: number | null
  poolsValidated: number
  lastValidatedAt: number | null
}

export function proof(): Promise<Proof> {
  return swr('proof', 5 * 60_000, async () => {
    const pools = db.prepare(`SELECT COUNT(*) AS n FROM pools`).get() as { n: number }
    const verified = db.prepare(`SELECT COUNT(*) AS n FROM pools WHERE factory_verified = 1`).get() as { n: number }
    const byVersion = db.prepare(`SELECT COALESCE(version, 3) AS v, COUNT(*) AS n FROM pools GROUP BY v`).all() as { v: number; n: number }[]
    const hooked = db.prepare(`SELECT COUNT(*) AS n FROM pools WHERE hooks IS NOT NULL AND hooks != '0x0000000000000000000000000000000000000000'`).get() as { n: number }
    const tokens = db.prepare(`SELECT COUNT(*) AS n FROM tokens`).get() as { n: number }
    let v = { total: 0, exact: 0, pools: 0, last: null as number | null }
    try {
      const row = db.prepare(`SELECT SUM(swaps) AS total, SUM(exact_out) AS exact, COUNT(*) AS pools, MAX(ran_at) AS last FROM validations WHERE swaps > 0`).get() as {
        total: number | null
        exact: number | null
        pools: number
        last: number | null
      }
      v = { total: row.total ?? 0, exact: row.exact ?? 0, pools: row.pools, last: row.last }
    } catch {
      // the table appears after the first scheduled validation
    }
    const fills24h = (storedSnapshot(86_400) ?? []).reduce((a, r) => a + r.trades24, 0)
    return {
      pools: pools.n,
      verifiedPools: verified.n,
      v3Pools: byVersion.find((r) => r.v === 3)?.n ?? 0,
      v4Pools: byVersion.find((r) => r.v === 4)?.n ?? 0,
      hookedPools: hooked.n,
      tokens: tokens.n,
      fills24h,
      replayedSwaps: v.total,
      exactSwaps: v.exact,
      exactPct: v.total > 0 ? (v.exact / v.total) * 100 : null,
      poolsValidated: v.pools,
      lastValidatedAt: v.last,
    }
  })
}
