import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { pctChange, quoteDepth, screenerRows, type ScreenerSort } from '@/lib/screener'
import { ethUsdRate } from '@/lib/usd'

/**
 * GET /api/v1/pools?sort=traction|vol|change5m|change30m|trades|depth&limit=50&safe=1
 * One row per token (deepest pool is the face), with traction and depth.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const sort = (['traction', 'vol', 'change5m', 'change30m', 'trades', 'depth'].includes(q.get('sort') ?? '') ? q.get('sort') : 'traction') as ScreenerSort
  const limit = Math.min(200, Math.max(1, Number(q.get('limit') ?? 50)))
  const safe = q.get('safe') !== '0'
  const rate = ethUsdRate()
  const rows = screenerRows(limit, sort, safe ? 3 : 0).filter((r) => !safe || r.factory_verified === 1)
  return NextResponse.json(
    {
      ethUsd: rate,
      rows: rows.map((r) => ({
        token: r.baseAddr,
        symbol: r.baseSymbol,
        name: r.baseName,
        facePool: r.address,
        version: r.address.length === 66 ? 4 : 3,
        fee: r.fee,
        quote: r.quote_symbol,
        pools: r.poolCount,
        price: r.lastClose,
        change5m: pctChange(r.lastClose, r.close5m),
        change30m: pctChange(r.lastClose, r.close30m),
        vol24: r.vol24,
        trades24: r.trades24,
        vol30: r.vol30,
        vol30prev: r.vol30prev,
        depthQuote: quoteDepth(r),
        verified: r.factory_verified === 1,
      })),
    },
    { headers: limitHeaders(rl) },
  )
}
