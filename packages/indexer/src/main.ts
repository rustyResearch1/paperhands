import { makeClient } from '@paperhands/chain'
import { getMeta, openDb, setMeta } from './db.js'
import { fetchLiqLogs, fetchSwapLogs, insertLiqEvents } from './discover.js'
import { replayPool } from './history.js'
import { Ingestor, watchLoop } from './watch.js'

const cmd = process.argv[2] ?? 'all'
const client = makeClient()
const db = openDb()

/** Bootstrap: sweep recent history so the screener has pools, prices, candles. */
async function discover(blocks = 20_000n) {
  const latest = await client.getBlockNumber()
  // Resume from the saved cursor when it's inside the sweep window, so a
  // restart doesn't leave a silent gap and doesn't re-fetch covered ranges.
  const saved = getMeta(db, 'watch_cursor')
  let from = latest > blocks ? latest - blocks : 1n
  if (saved && BigInt(saved) > from && BigInt(saved) < latest) from = BigInt(saved) + 1n
  if (saved && BigInt(saved) < latest - blocks) {
    console.warn(`discover: saved cursor ${saved} is older than the ${blocks}-block sweep — blocks ${saved}..${from - 1n} stay unindexed`)
  }
  console.log(`discover: scanning blocks ${from}..${latest} for active pools`)
  const ingestor = new Ingestor(client, db)
  await ingestor.clock.sync()

  const chunk = 4000n
  for (let start = from; start <= latest; start += chunk) {
    const end = start + chunk - 1n > latest ? latest : start + chunk - 1n
    const swaps = await fetchSwapLogs(client, start, end)
    const { ingested, newPools } = await ingestor.ingest(swaps)
    console.log(`discover: ${start}..${end} swaps=${swaps.length} ingested=${ingested} newPools=${newPools}`)
  }
  setMeta(db, 'watch_cursor', latest.toString())

  const stats = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM pools) AS pools,
         (SELECT COUNT(*) FROM pools WHERE factory_verified=1) AS verified,
         (SELECT COUNT(*) FROM pools WHERE base_is_token0 IS NOT NULL) AS priced,
         (SELECT COUNT(*) FROM tokens) AS tokens,
         (SELECT COUNT(*) FROM swaps) AS swaps`,
    )
    .get() as Record<string, number>
  console.log(
    `discover: done — ${stats.pools} pools (${stats.verified} factory-verified, ${stats.priced} WETH-priced), ${stats.tokens} tokens, ${stats.swaps} swaps`,
  )
}

/**
 * Backfill Mint/Burn events and per-swap liquidity over the already-indexed
 * span, enabling historical reconstruction from the first indexed block.
 */
async function withRetries<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const wait = 2000 * (i + 1)
      console.warn(`${label}: attempt ${i + 1} failed (${(err as Error).message.split('\n')[0]}), retrying in ${wait}ms`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}

async function liqBackfill() {
  const from = (db.prepare('SELECT MIN(block) AS b FROM swaps').get() as { b: number | null }).b
  const cursor = getMeta(db, 'watch_cursor')
  if (!from || !cursor) throw new Error('nothing indexed yet — run discover first')
  const to = Number(cursor)
  const chunk = 20_000

  const bfDone = Number(getMeta(db, 'liq_bf_to') ?? from - 1)
  console.log(`liq-backfill: mint/burn over ${Math.max(from, bfDone + 1)}..${to}`)
  for (let start = Math.max(from, bfDone + 1); start <= to; start += chunk) {
    const end = Math.min(start + chunk - 1, to)
    const events = await withRetries(`liq ${start}..${end}`, () => fetchLiqLogs(client, BigInt(start), BigInt(end)))
    const n = insertLiqEvents(db, events)
    setMeta(db, 'liq_bf_to', String(end))
    console.log(`liq-backfill: ${start}..${end} events=${events.length} stored=${n}`)
  }

  const fillDone = Number(getMeta(db, 'liq_fill_to') ?? from - 1)
  const missing = (db.prepare('SELECT COUNT(*) AS n FROM swaps WHERE liquidity IS NULL').get() as { n: number }).n
  if (missing > 0) {
    console.log(`liq-backfill: filling liquidity on ${missing} swap rows from ${Math.max(from, fillDone + 1)}`)
    const upd = db.prepare('UPDATE swaps SET liquidity = ? WHERE tx_hash = ? AND log_index = ? AND liquidity IS NULL')
    for (let start = Math.max(from, fillDone + 1); start <= to; start += chunk) {
      const end = Math.min(start + chunk - 1, to)
      const swaps = await withRetries(`swaps ${start}..${end}`, () => fetchSwapLogs(client, BigInt(start), BigInt(end)))
      const tx = db.transaction(() => {
        for (const s of swaps) upd.run(s.liquidity.toString(), s.txHash, s.logIndex)
      })
      tx()
      setMeta(db, 'liq_fill_to', String(end))
      console.log(`liq-backfill: liquidity ${start}..${end} (${swaps.length} swaps)`)
    }
  }
  setMeta(db, 'liq_from', String(from))
  const stats = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM liq_events) AS liq,
              (SELECT COUNT(*) FROM swaps WHERE liquidity IS NULL) AS missing`,
    )
    .get() as { liq: number; missing: number }
  console.log(`liq-backfill: done — ${stats.liq} liq events, ${stats.missing} swaps still missing liquidity`)
}

/** Prove the replay engine: re-execute recorded swaps, compare to what happened. */
async function replayValidate(poolArg?: string) {
  const pool =
    poolArg?.toLowerCase() ??
    (
      db
        .prepare(
          `SELECT p.address FROM pools p WHERE p.base_is_token0 IS NOT NULL AND p.factory_verified = 1
           ORDER BY p.swap_count DESC LIMIT 1`,
        )
        .get() as { address: string }
    ).address
  const liqFrom = Number(getMeta(db, 'liq_from') ?? NaN)
  if (Number.isNaN(liqFrom)) throw new Error('run liq-backfill first')
  const span = db
    .prepare(
      `SELECT MIN(block) AS lo, MAX(block) AS hi, COUNT(*) AS n FROM
       (SELECT block FROM swaps WHERE pool = ? AND block > ? ORDER BY block DESC LIMIT 2000)`,
    )
    .get(pool, liqFrom) as { lo: number; hi: number; n: number }
  if (!span.n) throw new Error('no swaps to validate')

  console.log(`replay-validate: ${pool} — ${span.n} swaps over blocks ${span.lo}..${span.hi}`)
  const stats = await replayPool(client, db, pool, span.lo, span.hi, { snapToRecorded: true })
  const outRate = ((stats.exactOut / Math.max(stats.swaps, 1)) * 100).toFixed(2)
  const priceRate = ((stats.exactPrice / Math.max(stats.swaps, 1)) * 100).toFixed(2)
  console.log(
    `replay-validate: ${stats.swaps} swaps, ${stats.liqEvents} liq events — amountOut exact ${outRate}%, sqrtPrice exact ${priceRate}%`,
  )
}

if (cmd === 'discover') {
  await discover()
  process.exit(0)
} else if (cmd === 'content') {
  const { generateContentPack } = await import('./content.js')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const md = await generateContentPack(client, db)
  const dir = new URL('../../../content/', import.meta.url).pathname
  mkdirSync(dir, { recursive: true })
  const file = `${dir}${new Date().toISOString().slice(0, 10)}.md`
  writeFileSync(file, md)
  console.log(md)
  console.log(`\nsaved: ${file}`)
  process.exit(0)
} else if (cmd === 'backup') {
  const { runBackup } = await import('./backup.js')
  await runBackup(db, db.name)
  process.exit(0)
} else if (cmd === 'liq-backfill') {
  await liqBackfill()
  process.exit(0)
} else if (cmd === 'replay-validate') {
  await replayValidate(process.argv[3])
  process.exit(0)
} else if (cmd === 'watch') {
  await watchLoop(client, db)
} else if (cmd === 'all') {
  await discover()
  await watchLoop(client, db)
} else {
  console.error(`unknown command: ${cmd} (use discover | liq-backfill | replay-validate | watch | all)`)
  process.exit(1)
}
