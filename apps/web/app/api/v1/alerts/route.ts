import { NextRequest, NextResponse } from 'next/server'
import { marketAlerts } from '@/lib/alerts'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'

/**
 * GET /api/v1/alerts?limit=30
 * Liquidity pulls (≥50% of active depth in one tx, last ~2h), dumps (−50% in
 * 3h with real volume) and volume surges (≥4× the previous half hour).
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 30)))
  return NextResponse.json({ alerts: marketAlerts(limit), at: Date.now() }, { headers: limitHeaders(rl) })
}
