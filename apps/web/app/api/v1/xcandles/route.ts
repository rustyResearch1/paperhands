import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { isXChain } from '@/lib/x'
import { poolCandles } from '@/lib/x/gecko'

/**
 * GET /api/v1/xcandles?chain=sol|bsc&pool=<address>&tf=minute|hour|day&agg=1&limit=300
 * USD candles for a pool on a chain we don't index ourselves (GeckoTerminal).
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 60)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const chain = q.get('chain')
  const pool = q.get('pool') ?? ''
  const tf = (['minute', 'hour', 'day'].includes(q.get('tf') ?? '') ? q.get('tf') : 'minute') as 'minute' | 'hour' | 'day'
  const agg = Math.max(1, Math.min(60, Number(q.get('agg') ?? 1)))
  const limit = Math.max(10, Math.min(1000, Number(q.get('limit') ?? 300)))
  if (!isXChain(chain) || chain === 'rh' || !pool) return NextResponse.json({ error: 'chain (sol|bsc) and pool required' }, { status: 400, headers: limitHeaders(rl) })
  try {
    const candles = await poolCandles(chain, pool, tf, agg, limit)
    return NextResponse.json({ chain, pool, candles }, { headers: limitHeaders(rl) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers: limitHeaders(rl) })
  }
}
