import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { bscLpPositions, bscPoolsFor, bscRanges, planBscMint } from '@/lib/x/bsclp'

export const maxDuration = 60

/**
 * GET /api/lp/bsc?token=0x…            → PancakeSwap v3 WBNB pools for the token (live depth)
 * GET /api/lp/bsc?pool=0x…             → σ-based suggested ranges for that pool
 * GET /api/lp/bsc?pool=0x…&range=30&bnb=0.5 → mint plan (ticks, exact amounts)
 * GET /api/lp/bsc?owner=0x…            → the wallet's PancakeSwap v3 positions
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 40)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const token = q.get('token')?.toLowerCase()
  const pool = q.get('pool')?.toLowerCase()
  const owner = q.get('owner')?.toLowerCase()
  const isAddr = (v: string | undefined | null): v is string => Boolean(v && /^0x[0-9a-f]{40}$/.test(v))
  try {
    if (isAddr(owner)) return NextResponse.json({ positions: await bscLpPositions(owner) }, { headers: limitHeaders(rl) })
    if (isAddr(token)) return NextResponse.json({ pools: await bscPoolsFor(token) }, { headers: limitHeaders(rl) })
    if (isAddr(pool)) {
      const range = Number(q.get('range') ?? NaN)
      const bnb = Number(q.get('bnb') ?? NaN)
      const strategy = await bscRanges(pool)
      if (!(range >= 1 && range <= 300) || !(bnb > 0 && bnb <= 100)) return NextResponse.json({ strategy }, { headers: limitHeaders(rl) })
      const plan = await planBscMint(pool, range, BigInt(Math.round(bnb * 1e6)) * 10n ** 12n)
      return NextResponse.json({ strategy, plan }, { headers: limitHeaders(rl) })
    }
    return NextResponse.json({ error: 'token, pool or owner required' }, { status: 400, headers: limitHeaders(rl) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers: limitHeaders(rl) })
  }
}
