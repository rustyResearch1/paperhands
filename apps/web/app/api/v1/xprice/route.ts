import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { nativePrices } from '@/lib/x/compare'

let cache: { at: number; v: Record<string, number | null> } | null = null

/** GET /api/v1/xprice — USD price of ETH (Robinhood Chain), SOL and BNB. */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 60)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), v: await nativePrices() }
  return NextResponse.json({ ...cache.v, at: cache.at }, { headers: limitHeaders(rl) })
}
