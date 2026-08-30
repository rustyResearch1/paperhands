import { makeClient } from '@paperhands/chain'
import { getMeta, openDb, setMeta } from './db.js'
import { fetchSwapLogs } from './discover.js'
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

if (cmd === 'discover') {
  await discover()
  process.exit(0)
} else if (cmd === 'watch') {
  await watchLoop(client, db)
} else if (cmd === 'all') {
  await discover()
  await watchLoop(client, db)
} else {
  console.error(`unknown command: ${cmd} (use discover | watch | all)`)
  process.exit(1)
}
