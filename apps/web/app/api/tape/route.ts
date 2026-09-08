import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { closedTrades, freshPools, latestFills, tapeStats } from '@/lib/tape'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tape?since=<block>&limit=120&tracked=1&side=buy|sell&minUsd=100
 * GET /api/tape?stats=1 · ?fresh=1 · ?closed=1
 * The Robinhood Chain live tape, straight from the ledger.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 240)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const headers = { ...limitHeaders(rl), 'Cache-Control': 'no-store' }
  try {
    if (q.get('stats')) return NextResponse.json(tapeStats(), { headers })
    if (q.get('fresh')) return NextResponse.json({ pools: freshPools(Math.min(50, Number(q.get('limit') ?? 20))) }, { headers })
    if (q.get('closed')) return NextResponse.json(closedTrades(Math.min(300, Number(q.get('limit') ?? 100))), { headers })
    const since = q.get('since')
    const side = q.get('side')
    const fills = latestFills({
      sinceBlock: since ? Number(since) : undefined,
      limit: Number(q.get('limit') ?? 120),
      tracked: q.get('tracked') === '1',
      side: side === 'buy' || side === 'sell' ? side : undefined,
      minUsd: Number(q.get('minUsd') ?? 0) || undefined,
    })
    return NextResponse.json({ fills, at: Date.now() }, { headers })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers })
  }
}
