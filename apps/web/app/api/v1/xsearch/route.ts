import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { solSearch } from '@/lib/x/sol'

/** GET /api/v1/xsearch?chain=sol&q=<symbol|name|mint> — token search (Jupiter). */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 60)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const chain = req.nextUrl.searchParams.get('chain')
  if (chain !== 'sol' || q.length < 2) return NextResponse.json({ results: [] }, { headers: limitHeaders(rl) })
  try {
    const results = await solSearch(q)
    return NextResponse.json({ results }, { headers: limitHeaders(rl) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, results: [] }, { status: 502, headers: limitHeaders(rl) })
  }
}
