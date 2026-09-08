import { NextRequest, NextResponse } from 'next/server'
import { planMint, suggestRanges } from '@/lib/lpstrategy'

/**
 * GET /api/lp/plan?pool=&range=&eth=   → mint parameters for a real position
 * GET /api/lp/plan?pool=               → volatility-based range suggestions
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const pool = q.get('pool')?.toLowerCase()
  if (!pool || !/^0x[0-9a-f]{40}$/.test(pool)) return NextResponse.json({ error: 'pool required (v3)' }, { status: 400 })
  try {
    const strategy = suggestRanges(pool)
    const range = q.get('range')
    const eth = q.get('eth')
    if (!range || !eth) return NextResponse.json({ strategy })
    const rangePct = Number(range)
    const ethNum = Number(eth)
    if (!(rangePct >= 1 && rangePct <= 300) || !(ethNum > 0 && ethNum <= 1000)) {
      return NextResponse.json({ error: 'range 1–300, eth 0–1000' }, { status: 422 })
    }
    const plan = await planMint(pool, rangePct, BigInt(Math.round(ethNum * 1e6)) * 10n ** 12n)
    return NextResponse.json({ strategy, plan })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
