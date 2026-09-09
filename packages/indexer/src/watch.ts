import { hasDedicatedRpc, type ChainClient } from '@paperhands/chain'
import type Database from 'better-sqlite3'
import type { Address } from 'viem'
import { fetchLiqLogs, fetchSwapLogs, insertLiqEvents, resolvePool, type DecodedSwap } from './discover.js'
import { fetchV4Logs, fetchV4LiqForPool, registerV4Pool, resolveV4PoolById } from './discoverV4.js'
import { executeTails } from './tails.js'
import { basePriceInQuote, toHuman } from './prices.js'
import { getMeta, hasIndex, setMeta } from './db.js'
import { refreshAlerts } from './alerts.js'
import { refreshScreener } from './screener.js'
import { BlockClock } from './timestamps.js'
import { validateNextPool } from './validate.js'
import { ensureWireRank, refreshWireRank } from './wire.js'

interface PoolCache {
  baseIsToken0: number | null
  baseDecimals: number
  quoteDecimals: number
  verified: boolean
}

export class Ingestor {
  private cache = new Map<string, PoolCache | null>()
  readonly clock: BlockClock

  constructor(
    private client: ChainClient,
    private db: Database.Database,
  ) {
    this.clock = new BlockClock(client)
  }

  private loadPoolCache(pool: string): PoolCache | null {
    const hit = this.cache.get(pool)
    if (hit !== undefined) return hit
    const row = this.db
      .prepare(
        `SELECT p.base_is_token0, p.factory_verified,
                t0.decimals AS d0, t1.decimals AS d1
         FROM pools p
         JOIN tokens t0 ON t0.address = p.token0
         JOIN tokens t1 ON t1.address = p.token1
         WHERE p.address = ?`,
      )
      .get(pool) as { base_is_token0: number | null; factory_verified: number; d0: number; d1: number } | undefined
    if (!row) {
      this.cache.set(pool, null)
      return null
    }
    const entry: PoolCache = {
      baseIsToken0: row.base_is_token0,
      baseDecimals: row.base_is_token0 === 1 ? row.d0 : row.d1,
      quoteDecimals: row.base_is_token0 === 1 ? row.d1 : row.d0,
      verified: row.factory_verified === 1,
    }
    this.cache.set(pool, entry)
    return entry
  }

  invalidate(pool: string) {
    this.cache.delete(pool)
  }

  /** Ingest a batch of decoded swaps: swaps table, candles, pool last-state. */
  async ingest(swaps: DecodedSwap[], resolveUnknown = true): Promise<{ ingested: number; newPools: number }> {
    let newPools = 0
    const unknown = new Set<string>()
    // The pool's own first swap in this batch is its discovery block — not the batch's first
    // swap, which on a catch-up tick would stamp every new pool with the same block.
    const firstBlock = new Map<string, bigint>()
    for (const s of swaps) {
      const pool = s.pool.toLowerCase()
      if (this.loadPoolCache(pool) === null) {
        unknown.add(pool)
        const prev = firstBlock.get(pool)
        if (prev === undefined || s.block < prev) firstBlock.set(pool, s.block)
      }
    }
    if (resolveUnknown && unknown.size > 0) {
      const liqFrom = getMeta(this.db, 'liq_from')
      const lastBlock = swaps[swaps.length - 1]!.block
      const queue = [...unknown]
      const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
        for (let pool = queue.pop(); pool; pool = queue.pop()) {
          // 66-char keys are v4 pool ids; 42-char keys are v3 pool addresses.
          const isV4 = pool.length === 66
          const resolved = isV4
            ? await resolveV4PoolById(this.client, this.db, pool)
            : Boolean(await resolvePool(this.client, this.db, pool as Address, firstBlock.get(pool) ?? swaps[0]!.block))
          if (!resolved) continue
          newPools++
          this.invalidate(pool)
          // A pool discovered after the liq backfill is missing its
          // liquidity history. Reconstruction floors such pools ~30k blocks
          // before discovery, so only that window is fetched — and a
          // discovery storm on a catch-up tick must not fan out into
          // hundreds of heavy address-filtered fetches.
          if (liqFrom && unknown.size <= 40) {
            try {
              const from = lastBlock - 30_000n > BigInt(liqFrom) ? lastBlock - 30_000n : BigInt(liqFrom)
              const events = isV4
                ? await fetchV4LiqForPool(this.client, pool, from, lastBlock)
                : await fetchLiqLogs(this.client, from, lastBlock, 10_000n, pool as Address)
              insertLiqEvents(this.db, events)
            } catch (err) {
              console.error(`liq catchup failed for ${pool}:`, (err as Error).message.split('\n')[0])
            }
          }
        }
      })
      await Promise.all(workers)
    }

    const insertSwap = this.db.prepare(
      `INSERT OR IGNORE INTO swaps(tx_hash, log_index, pool, block, ts, amount0, amount1, sqrt_price_x96, tick, liquidity)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    const updatePool = this.db.prepare(
      `UPDATE pools SET last_swap_block=?, last_sqrt_price=?, last_tick=?, last_liquidity=?, swap_count=swap_count+1
       WHERE address=? AND (last_swap_block IS NULL OR last_swap_block <= ?)`,
    )
    const upsertCandle = this.db.prepare(
      `INSERT INTO candles(pool, minute_ts, open, high, low, close, vol_quote, trades)
       VALUES(?,?,?,?,?,?,?,1)
       ON CONFLICT(pool, minute_ts) DO UPDATE SET
         high = MAX(high, excluded.high),
         low = MIN(low, excluded.low),
         close = excluded.close,
         vol_quote = vol_quote + excluded.vol_quote,
         trades = trades + 1`,
    )

    let ingested = 0
    const tx = this.db.transaction((batch: DecodedSwap[]) => {
      for (const s of batch) {
        const pool = s.pool.toLowerCase()
        const meta = this.loadPoolCache(pool)
        if (!meta) continue
        const ts = this.clock.estimate(s.block)
        const inserted = insertSwap.run(
          s.txHash,
          s.logIndex,
          pool,
          Number(s.block),
          ts,
          s.amount0.toString(),
          s.amount1.toString(),
          s.sqrtPriceX96.toString(),
          s.tick,
          s.liquidity.toString(),
        )
        // Replays (crash before cursor save, or a discover re-sweep) must not
        // double-count candles or swap totals — only a genuinely new swap row
        // may touch the aggregates.
        if (inserted.changes === 0) continue
        updatePool.run(Number(s.block), s.sqrtPriceX96.toString(), s.tick, s.liquidity.toString(), pool, Number(s.block))

        if (meta.baseIsToken0 !== null) {
          const price = basePriceInQuote(
            s.sqrtPriceX96,
            meta.baseIsToken0 === 1,
            meta.baseDecimals,
            meta.quoteDecimals,
          )
          const quoteAmount = meta.baseIsToken0 === 1 ? s.amount1 : s.amount0
          const vol = Math.abs(toHuman(quoteAmount < 0n ? -quoteAmount : quoteAmount, meta.quoteDecimals))
          const minute = Math.floor(ts / 60) * 60
          if (Number.isFinite(price) && price > 0) {
            upsertCandle.run(pool, minute, price, price, price, price, vol)
          }
        }
        ingested++
      }
    })
    tx(swaps)
    return { ingested, newPools }
  }

  /**
   * Attribute recent swaps to their sender for the KOL/leaderboard layer.
   * Concurrency-capped so a busy tick can't fire a 120-way burst at the
   * public RPC; failures stay NULL and retry on a later tick (a transient
   * error must never permanently poison attribution).
   */
  async enrichTraders(limit = 120): Promise<number> {
    // Biggest fills first: on a capped RPC the lookup budget names the trades a trencher
    // cares about and lets the sub-dollar bot churn go unnamed. Size = the quote leg in
    // human units (by the quote token's own decimals), ETH weighted ×1000 so ETH- and
    // dollar-quoted pools rank together — a priority, not a displayed number. Only the
    // last ~15 minutes of blocks compete; the block index keeps this ~0.5s on a big ledger.
    // `INDEXED BY` on a late index throws at prepare time while that index is
    // still being built by the other process — which would wedge the tick.
    const hint = hasIndex(this.db, 'swaps_block') ? 'INDEXED BY swaps_block' : ''
    const rows = this.db
      .prepare(
        `SELECT tx_hash FROM (
           SELECT s.tx_hash,
                  MAX(ABS(CASE WHEN p.base_is_token0 = 1 THEN CAST(s.amount1 AS REAL) ELSE CAST(s.amount0 AS REAL) END)
                      / (CASE tq.decimals WHEN 6 THEN 1e6 WHEN 8 THEN 1e8 ELSE 1e18 END)
                      * (CASE WHEN COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH') THEN 1000 ELSE 1 END)) AS sz
           FROM swaps s ${hint}
           JOIN pools p ON p.address = s.pool
           JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0 = 1 THEN p.token1 ELSE p.token0 END
           WHERE s.trader IS NULL AND p.base_is_token0 IS NOT NULL AND s.block > (SELECT MAX(block) FROM swaps) - 10000
           GROUP BY s.tx_hash
           ORDER BY sz DESC LIMIT ?
         )`,
      )
      .all(limit) as { tx_hash: string }[]
    if (rows.length === 0) return 0
    const update = this.db.prepare('UPDATE swaps SET trader = ? WHERE tx_hash = ?')
    const queue = rows.map((r) => r.tx_hash)
    let n = 0
    // 100 in flight on a dedicated key fills viem's 100-call JSON-RPC batches (one HTTP request each).
    const workers = Array.from({ length: Math.min(hasDedicatedRpc() ? 100 : 8, queue.length) }, async () => {
      for (let tx_hash = queue.pop(); tx_hash; tx_hash = queue.pop()) {
        try {
          const tx = await this.client.getTransaction({ hash: tx_hash as `0x${string}` })
          update.run(tx.from.toLowerCase(), tx_hash)
          n++
        } catch {
          // leave NULL; a later tick retries
        }
      }
    })
    await Promise.all(workers)
    return n
  }
}

const CURSOR_KEY = 'watch_cursor'

/**
 * Retention: swaps and liquidity events power the tape, wire, and replay —
 * a rolling window (default 7 days) bounds the DB; candles stay forever
 * (they're small and power every chart). The replay floor moves with the
 * oldest retained swap so reconstruction stays consistent.
 */
/**
 * Retention prune in small batches: one giant DELETE holds the write lock for
 * minutes on a big ledger and every web request that needs to write (a new
 * session, a paper trade) stalls behind it. 20k rows per statement keeps
 * each lock under ~100ms; the loop yields between batches.
 */
async function pruneOldRows(db: Database.Database, nowSec: number) {
  const days = Number(process.env.PAPERHANDS_RETAIN_DAYS ?? 7)
  const cutoff = nowSec - days * 86400
  const batch = 20_000
  let swaps = 0
  // `ts` has no index, so deleting by it made the final batch a full-table scan
  // inside a write transaction. Convert the cutoff to a block once (block IS
  // indexed) and delete by that instead.
  const cutoffBlock = (db.prepare('SELECT MAX(block) AS b FROM swaps WHERE ts < ?').get(cutoff) as { b: number | null }).b
  if (cutoffBlock !== null) {
    // Same rule as everywhere else: naming an index that is still being built
    // throws when the statement is prepared, so only hint when it exists.
    const hint = hasIndex(db, 'swaps_block') ? 'INDEXED BY swaps_block' : ''
    const del = db.prepare(`DELETE FROM swaps WHERE rowid IN (SELECT rowid FROM swaps ${hint} WHERE block <= ? LIMIT ?)`)
    for (;;) {
      const n = del.run(cutoffBlock, batch).changes
      swaps += n
      if (n < batch) break
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  const floor = (db.prepare('SELECT MIN(block) AS b FROM swaps').get() as { b: number | null }).b
  let liq = 0
  if (floor) {
    for (;;) {
      const n = db.prepare('DELETE FROM liq_events WHERE rowid IN (SELECT rowid FROM liq_events WHERE block < ? LIMIT ?)').run(floor, batch).changes
      liq += n
      if (n < batch) break
      await new Promise((r) => setTimeout(r, 50))
    }
    const cur = Number(getMeta(db, 'liq_from') ?? 0)
    if (floor > cur) setMeta(db, 'liq_from', String(floor))
  }
  if (swaps || liq) console.log(`prune: dropped ${swaps} swaps, ${liq} liq events (retain ${days}d)`)
  // Truncate the WAL while we are the only writer; readers make this a no-op,
  // which is fine — the next prune tries again.
  try {
    const rows = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number; log: number; checkpointed: number }[]
    const r = rows[0]
    if (r) console.log(`wal: checkpoint busy=${r.busy} pages=${r.log} checkpointed=${r.checkpointed}`)
  } catch (err) {
    console.warn('wal checkpoint skipped:', (err as Error).message)
  }
}
const GAP_LIMIT = 150_000n // ~3h of blocks; beyond this, RPC state is pruned and catch-up is hopeless

export async function watchLoop(client: ChainClient, db: Database.Database, opts: { pollMs?: number } = {}) {
  const ingestor = new Ingestor(client, db)
  await ingestor.clock.sync()

  let cursor: bigint
  const saved = getMeta(db, CURSOR_KEY)
  if (saved) {
    cursor = BigInt(saved)
  } else {
    cursor = (await client.getBlockNumber()) - 1000n
  }

  // Self-heal: a long outage leaves an unfillable hole (pruned state, hours
  // of grinding). Jump forward, move the replay floor, record the gap.
  const head = await client.getBlockNumber()
  if (head - cursor > GAP_LIMIT) {
    const jumped = head - 20_000n
    const gaps = getMeta(db, 'history_gaps') ?? ''
    setMeta(db, 'history_gaps', `${gaps}${cursor}-${jumped};`)
    console.warn(`watch: cursor lagged head by ${head - cursor} blocks — jumping ${cursor} → ${jumped}; replay floor moves with it`)
    cursor = jumped
    setMeta(db, CURSOR_KEY, cursor.toString())
    setMeta(db, 'liq_from', cursor.toString())
  }

  let lastBackup = Number(getMeta(db, 'last_backup_ts') ?? 0)
  let lastWire = Number(getMeta(db, 'wire_rank_ts') ?? 0)
  // A schema change recreates the table empty; rank right away rather than
  // leaving the Wire to compute live for up to ten minutes.
  ensureWireRank(db)
  const wireEmpty = (db.prepare('SELECT COUNT(*) AS n FROM wire_rank').get() as { n: number }).n === 0
  if (wireEmpty) lastWire = 0
  // Right after a deploy the web and the indexer share one small box: give
  // page loads the CPU first and start the heavy refreshes two minutes in
  // (stored snapshots are served meanwhile), unless there is nothing stored.
  const bootGrace = Math.floor(Date.now() / 1000) + (wireEmpty ? 0 : 120)
  let lastValidate = 0
  let lastScreener = 0
  let failures = 0
  // Catch-up chunk adapts to what the RPC will actually serve: a failed
  // tick halves it, a clean tick grows it back — a wedged loop that never
  // advances the cursor is worse than a slow one.
  let chunk = 5_000n

  console.log(`watch: starting from block ${cursor}`)
  for (;;) {
    try {
      if (ingestor.clock.needsSync()) await ingestor.clock.sync()
      const latest = await client.getBlockNumber()
      if (latest > cursor) {
        const to = latest - cursor > chunk ? cursor + chunk : latest
        const swaps = await fetchSwapLogs(client, cursor + 1n, to)
        const { ingested, newPools } = await ingestor.ingest(swaps)
        if (getMeta(db, 'liq_from')) {
          const liqEvents = await fetchLiqLogs(client, cursor + 1n, to)
          insertLiqEvents(db, liqEvents)
        }
        // v4: the singleton PoolManager carries inits, swaps, and liquidity
        // in one address-filtered stream.
        const v4 = await fetchV4Logs(client, cursor + 1n, to)
        for (const init of v4.inits) await registerV4Pool(client, db, init)
        const r4 = await ingestor.ingest(v4.swaps)
        insertLiqEvents(db, v4.liq)
        // Attribution (tx → wallet) is one lookup per transaction: 60 per tick
        // is all the public RPC tolerates; a dedicated endpoint gets thousands.
        const enriched = await ingestor.enrichTraders(Number(process.env.PAPERHANDS_ATTRIB_PER_TICK ?? (hasDedicatedRpc() ? 3000 : 60)))
        const tailFills = await executeTails(client, db)
        if (tailFills > 0) console.log(`watch: mirrored ${tailFills} tail fill(s)`)

        const nowSec = Math.floor(Date.now() / 1000)
        if (nowSec - Number(getMeta(db, 'last_prune_ts') ?? 0) > 24 * 3600) {
          setMeta(db, 'last_prune_ts', String(nowSec))
          await pruneOldRows(db, nowSec)
        }
        if (nowSec - lastBackup > 6 * 3600) {
          lastBackup = nowSec
          setMeta(db, 'last_backup_ts', String(nowSec))
          const { runBackup } = await import('./backup.js')
          runBackup(db, db.name).catch((err) => console.error('backup failed:', (err as Error).message))
        }
        cursor = to
        setMeta(db, CURSOR_KEY, cursor.toString())
        if (chunk < 20_000n) chunk *= 2n
        // The Markets screener aggregation and the alerts feed, precomputed so
        // page loads read JSON.
        if (nowSec >= bootGrace && nowSec - lastScreener > 60) {
          lastScreener = nowSec
          const t0 = Date.now()
          try {
            const n = refreshScreener(db)
            const a = refreshAlerts(db)
            if (Date.now() - t0 > 3000) console.log(`watch: screener (${n} rows) + alerts (${a}) refreshed in ${Date.now() - t0}ms`)
          } catch (err) {
            console.error('screener/alerts refresh failed:', (err as Error).message)
          }
        }
        // The Wire ranking is too heavy for a web request; refresh it here.
        if ((nowSec >= bootGrace || wireEmpty) && nowSec - lastWire > 10 * 60) {
          lastWire = nowSec
          const t0 = Date.now()
          const n = refreshWireRank(db)
          console.log(`watch: wire rank refreshed (${n} wallets, ${Date.now() - t0}ms)`)
        }
        // Self-validation: replay one busy pool's recent swaps through the
        // engine while pinned state is still reachable (caught-up cursor).
        // Runs after the cursor is persisted so reconstruction sees this tick.
        if (nowSec >= bootGrace && nowSec - lastValidate > 30 * 60 && latest - to <= 2_000n) {
          lastValidate = nowSec
          const t0 = Date.now()
          const v = await validateNextPool(client, db, { headBlock: latest, cursor: to }).catch((err) => ({ pool: '?', swaps: 0, exactOutRate: 0, error: (err as Error).message }))
          if (v) {
            console.log(
              v.error
                ? `watch: validate ${v.pool.slice(0, 12)}… failed — ${v.error}`
                : `watch: validate ${v.pool.slice(0, 12)}… ${v.swaps} swaps, amountOut exact ${(v.exactOutRate * 100).toFixed(1)}% (${Date.now() - t0}ms)`,
            )
          }
        }
        if (swaps.length + v4.swaps.length > 0) {
          console.log(
            `watch: blocks→${to} v3=${ingested}/${swaps.length} v4=${r4.ingested}/${v4.swaps.length} newPools=${newPools + r4.newPools} traders+${enriched}`,
          )
        }
      }
      failures = 0
    } catch (err) {
      if (chunk > 500n) chunk /= 2n
      failures++
      const e = err as { message: string; status?: number; details?: string }
      const why = [e.message.split('\n')[0], e.status ? `HTTP ${e.status}` : '', e.details?.slice(0, 80) ?? ''].filter(Boolean).join(' · ')
      console.error(`watch: tick failed ×${failures} (chunk→${chunk}), retrying — ${why}`)
    }
    // A dedicated RPC turns the watcher into a live tape: a few blocks per tick, every few seconds.
    // Consecutive failures back off (6s → 12s → … → 60s): hammering a node that is refusing us only
    // keeps us refused, and the public RPC's limiter is per-minute.
    const base = opts.pollMs ?? (hasDedicatedRpc() ? 2500 : 6000)
    const wait = failures > 0 ? Math.min(60_000, 6000 * 2 ** (failures - 1)) : base
    await new Promise((r) => setTimeout(r, wait))
  }
}
