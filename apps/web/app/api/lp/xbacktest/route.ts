import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { xLpBacktest } from '@/lib/x/lpbacktest'

export const maxDuration = 60

/**
 * GET /api/lp/xbacktest?chain=sol|bsc&pool=…&range=30&usd=500&hours=24
 * Approximate LP backtest for pools we don't index: volume-share fees from
 * minute candles + current in-range liquidity, impermanent loss from the
 * price path. Labelled approximate — Robinhood Chain replays every swap.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 30)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const chain = q.get('chain')
  const pool = q.get('pool') ?? ''
  const range = Number(q.get('range') ?? 30)
  const usd = Number(q.get('usd') ?? 500)
  const hours = Number(q.get('hours') ?? 24)
  if ((chain !== 'sol' && chain !== 'bsc') || !pool || !(range >= 1 && range <= 300) || !(usd > 0 && usd <= 1e7) || !(hours >= 1 && hours <= 16)) {
    return NextResponse.json({ error: 'chain (sol|bsc), pool, range 1–300, usd, hours 1–16 required' }, { status: 400, headers: limitHeaders(rl) })
  }
  try {
    return NextResponse.json(await xLpBacktest(chain, pool, range, usd, hours), { headers: limitHeaders(rl) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers: limitHeaders(rl) })
  }
}
