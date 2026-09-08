import { NextRequest, NextResponse } from 'next/server'
import { getMeta, lpBacktest } from '@paperhands/indexer'
import { bump } from '@/lib/counters'
import { db } from '@/lib/db'
import { chainClient } from '@/lib/quote'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const pool = q.get('pool')?.toLowerCase()
  const rangePct = Number(q.get('range') ?? 30)
  const eth = Number(q.get('eth') ?? 1)
  const hours = Number(q.get('hours') ?? 24)
  if (!pool || !/^0x[0-9a-f]{40}$/.test(pool)) return NextResponse.json({ error: 'pool required' }, { status: 400 })
  if (!(rangePct >= 1 && rangePct <= 300)) return NextResponse.json({ error: 'range 1–300%' }, { status: 422 })
  if (!(eth > 0 && eth <= 100)) return NextResponse.json({ error: 'deposit 0–100 ETH' }, { status: 422 })
  if (!(hours >= 0.25 && hours <= 96)) return NextResponse.json({ error: 'lookback 0.25–96h' }, { status: 422 })

  const cursor = Number(getMeta(db, 'watch_cursor') ?? 0)
  const liqFrom = Number(getMeta(db, 'liq_from') ?? NaN)
  if (!cursor || Number.isNaN(liqFrom)) {
    return NextResponse.json({ error: 'history not backfilled yet — run the indexer liq-backfill' }, { status: 503 })
  }
  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600
  const row = db
    .prepare('SELECT MIN(block) AS b, COUNT(*) AS n FROM swaps WHERE pool = ? AND ts >= ?')
    .get(pool, cutoff) as { b: number | null; n: number }
  if (!row.b || row.n < 2) return NextResponse.json({ error: 'not enough swap history in that window' }, { status: 422 })
  const fromBlock = Math.max(row.b, liqFrom)

  try {
    const result = await lpBacktest(chainClient, db, {
      pool,
      rangePct,
      quoteWei: BigInt(Math.round(eth * 1e6)) * 10n ** 12n,
      fromBlock,
      toBlock: cursor,
    })
    bump('lab.lp')
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
