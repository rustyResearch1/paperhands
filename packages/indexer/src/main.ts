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
} else if (cmd === 'v4-backfill') {
  const { fetchV4Logs, registerV4Pool } = await import('./discoverV4.js')
  const { insertLiqEvents } = await import('./discover.js')
  const { Ingestor } = await import('./watch.js')
  const cursor = Number(getMeta(db, 'watch_cursor') ?? 0)
  const liqFrom = Number(getMeta(db, 'liq_from') ?? 0)
  if (!cursor || !liqFrom) throw new Error('run discover + liq-backfill first')
  // v4 is the busiest venue — cap the sweep to what replay can actually use
  // and record its own floor (v4 reconstruction is valid from here forward).
  const blocksBack = Number(process.argv[3] ?? 200_000)
  const from = Math.max(liqFrom, cursor - blocksBack)
  setMeta(db, 'v4_liq_from', String(from))
  const ing = new Ingestor(client, db)
  await ing.clock.sync()
  console.log(`v4-backfill: PoolManager activity over ${from}..${cursor}`)
  const chunk = 20_000
  for (let start = from; start <= cursor; start += chunk) {
    const end = Math.min(start + chunk - 1, cursor)
    const v4 = await withRetries(`v4 ${start}..${end}`, () => fetchV4Logs(client, BigInt(start), BigInt(end)))
    for (const init of v4.inits) await registerV4Pool(client, db, init)
    const r = await ing.ingest(v4.swaps)
    const liq = insertLiqEvents(db, v4.liq)
    console.log(`v4-backfill: ${start}..${end} inits=${v4.inits.length} swaps=${r.ingested}/${v4.swaps.length} pools+${r.newPools} liq+${liq}`)
  }
  console.log('v4-backfill: done')
  process.exit(0)
} else if (cmd === 'migrate-quotes') {
  const { USDG } = await import('@paperhands/chain')
  const { basePriceInQuote, toHuman } = await import('./prices.js')
  const usdg = USDG.toLowerCase()
  db.prepare(`UPDATE pools SET quote_symbol='WETH' WHERE quote_symbol IS NULL AND base_is_token0 IS NOT NULL AND version=3`).run()
  const upgraded = db
    .prepare(
      `SELECT address, token0, token1 FROM pools
       WHERE base_is_token0 IS NULL AND version = 3 AND (token0 = ? OR token1 = ?)`,
    )
    .all(usdg, usdg) as { address: string; token0: string; token1: string }[]
  const setQuote = db.prepare(`UPDATE pools SET base_is_token0 = ?, quote_symbol = 'USDG' WHERE address = ?`)
  for (const p of upgraded) setQuote.run(p.token1 === usdg ? 1 : 0, p.address)
  console.log(`migrate-quotes: unlocked ${upgraded.length} USDG-quoted v3 pools`)

  // Rebuild candles for the newly priced pools from retained swaps.
  const upsert = db.prepare(
    `INSERT INTO candles(pool, minute_ts, open, high, low, close, vol_quote, trades) VALUES(?,?,?,?,?,?,?,1)
     ON CONFLICT(pool, minute_ts) DO UPDATE SET high=MAX(high,excluded.high), low=MIN(low,excluded.low),
       close=excluded.close, vol_quote=vol_quote+excluded.vol_quote, trades=trades+1`,
  )
  let candled = 0
  for (const p of upgraded) {
    const meta = db
      .prepare(
        `SELECT p.base_is_token0 AS b0, tb.decimals AS bd, tq.decimals AS qd FROM pools p
         JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0=1 THEN p.token0 ELSE p.token1 END
         JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0=1 THEN p.token1 ELSE p.token0 END
         WHERE p.address = ?`,
      )
      .get(p.address) as { b0: number; bd: number; qd: number } | undefined
    if (!meta) continue
    const swaps = db
      .prepare('SELECT ts, amount0, amount1, sqrt_price_x96 FROM swaps WHERE pool = ? ORDER BY block, log_index')
      .all(p.address) as { ts: number; amount0: string; amount1: string; sqrt_price_x96: string }[]
    const tx = db.transaction(() => {
      for (const s of swaps) {
        const price = basePriceInQuote(BigInt(s.sqrt_price_x96), meta.b0 === 1, meta.bd, meta.qd)
        if (!Number.isFinite(price) || price <= 0) continue
        const qAmt = BigInt(meta.b0 === 1 ? s.amount1 : s.amount0)
        const vol = Math.abs(toHuman(qAmt < 0n ? -qAmt : qAmt, meta.qd))
        upsert.run(p.address, Math.floor(s.ts / 60) * 60, price, price, price, price, vol)
        candled++
      }
    })
    tx()
  }
  console.log(`migrate-quotes: rebuilt ${candled} candle points`)
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
