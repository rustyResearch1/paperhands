import type { ChainClient } from '@paperhands/chain'
import type Database from 'better-sqlite3'
import type { Address } from 'viem'
import { fetchSwapLogs, resolvePool, type DecodedSwap } from './discover.js'
import { basePriceInQuote, toHuman } from './prices.js'
import { getMeta, setMeta } from './db.js'
import { BlockClock } from './timestamps.js'

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
    for (const s of swaps) {
      const pool = s.pool.toLowerCase()
      if (this.loadPoolCache(pool) === null) unknown.add(pool)
    }
    if (resolveUnknown && unknown.size > 0) {
      const queue = [...unknown]
      const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
        for (let pool = queue.pop(); pool; pool = queue.pop()) {
          const row = await resolvePool(this.client, this.db, pool as Address, swaps[0]!.block)
          if (row) {
            newPools++
            this.invalidate(pool)
          }
        }
      })
      await Promise.all(workers)
    }

    const insertSwap = this.db.prepare(
      `INSERT OR IGNORE INTO swaps(tx_hash, log_index, pool, block, ts, amount0, amount1, sqrt_price_x96, tick)
       VALUES(?,?,?,?,?,?,?,?,?)`,
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
        insertSwap.run(
          s.txHash,
          s.logIndex,
          pool,
          Number(s.block),
          ts,
          s.amount0.toString(),
          s.amount1.toString(),
          s.sqrtPriceX96.toString(),
          s.tick,
        )
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

  /** Attribute recent swaps to their sender for the KOL/leaderboard layer. */
  async enrichTraders(limit = 120): Promise<number> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT tx_hash FROM swaps WHERE trader IS NULL ORDER BY block DESC LIMIT ?`,
      )
      .all(limit) as { tx_hash: string }[]
    if (rows.length === 0) return 0
    const update = this.db.prepare('UPDATE swaps SET trader = ? WHERE tx_hash = ?')
    let n = 0
    await Promise.all(
      rows.map(async ({ tx_hash }) => {
        try {
          const tx = await this.client.getTransaction({ hash: tx_hash as `0x${string}` })
          update.run(tx.from.toLowerCase(), tx_hash)
          n++
        } catch {
          update.run('0x', tx_hash) // unresolvable; stop retrying it
        }
      }),
    )
    return n
  }
}

const CURSOR_KEY = 'watch_cursor'

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

  console.log(`watch: starting from block ${cursor}`)
  for (;;) {
    try {
      if (ingestor.clock.needsSync()) await ingestor.clock.sync()
      const latest = await client.getBlockNumber()
      if (latest > cursor) {
        const to = latest - cursor > 5000n ? cursor + 5000n : latest
        const swaps = await fetchSwapLogs(client, cursor + 1n, to)
        const { ingested, newPools } = await ingestor.ingest(swaps)
        const enriched = await ingestor.enrichTraders()
        cursor = to
        setMeta(db, CURSOR_KEY, cursor.toString())
        if (swaps.length > 0) {
          console.log(
            `watch: blocks→${to} swaps=${swaps.length} ingested=${ingested} newPools=${newPools} traders+${enriched}`,
          )
        }
      }
    } catch (err) {
      console.error('watch: tick failed, retrying —', (err as Error).message.split('\n')[0])
    }
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 4000))
  }
}
