import { NextRequest, NextResponse } from 'next/server'
import { getMeta, walletReplay } from '@paperhands/indexer'
import { db } from '@/lib/db'
import { chainClient } from '@/lib/quote'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'

export const maxDuration = 90

export async function GET(req: NextRequest) {
  // The heaviest endpoint on the site: a replay reads pinned pool state for up
  // to eight pools over the RPC. Six a minute per IP.
  const rl = rateLimit(req, 6)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited — replays are expensive' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const wallet = q.get('wallet')?.toLowerCase()
  const eth = Number(q.get('eth') ?? 0.25)
  const hours = Number(q.get('hours') ?? 24)
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ error: 'wallet required' }, { status: 400 })
  if (!(eth > 0 && eth <= 10)) return NextResponse.json({ error: 'size 0–10 ETH' }, { status: 422 })
  if (!(hours >= 1 && hours <= 96)) return NextResponse.json({ error: 'lookback 1–96h' }, { status: 422 })

  const cursor = Number(getMeta(db, 'watch_cursor') ?? 0)
  const liqFrom = Number(getMeta(db, 'liq_from') ?? NaN)
  if (!cursor || Number.isNaN(liqFrom)) {
    return NextResponse.json({ error: 'history not backfilled yet' }, { status: 503 })
  }
  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600
  const first = db
    .prepare('SELECT MIN(block) AS b FROM swaps WHERE trader = ? AND ts >= ?')
    .get(wallet, cutoff) as { b: number | null }
  if (!first.b) return NextResponse.json({ error: 'no attributed swaps for that wallet in the window' }, { status: 422 })

  try {
    const result = await walletReplay(
      chainClient,
      db,
      wallet,
      BigInt(Math.round(eth * 1e6)) * 10n ** 12n,
      Math.max(first.b - 1, liqFrom),
      cursor,
    )
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
