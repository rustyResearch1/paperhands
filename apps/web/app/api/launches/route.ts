import { NextRequest, NextResponse } from 'next/server'
import { curveState, launchDetail, launchFeed, quoteCurve, type LaunchFeed } from '@/lib/launches'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/launches?feed=new|trending|graduating|graduated&limit=40
 * GET /api/launches?token=0x…                → detail (trades, holders, deployer record)
 * GET /api/launches?token=0x…&quote=buy&eth=0.1   → live curve quote (exact maths)
 * GET /api/launches?token=0x…&quote=sell&tokens=1000000
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 120)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const headers = { ...limitHeaders(rl), 'Cache-Control': 'no-store' }
  const q = req.nextUrl.searchParams
  try {
    const token = q.get('token')?.toLowerCase()
    if (token) {
      if (!/^0x[0-9a-f]{40}$/.test(token)) return NextResponse.json({ error: 'bad token' }, { status: 400, headers })
      const d = launchDetail(token)
      if (!d) return NextResponse.json({ error: 'not a PONS launch we have seen' }, { status: 404, headers })
      const side = q.get('quote')
      if (side === 'buy' || side === 'sell') {
        const state = await curveState(d.launch.curve)
        const qd = BigInt(d.launch.quoteDecimals)
        const amountIn =
          side === 'buy'
            ? BigInt(Math.round(Number(q.get('amount') ?? q.get('eth') ?? '0.1') * 1e6)) * 10n ** (qd - 6n)
            : BigInt(Math.round(Number(q.get('tokens') ?? '0') * 1e6)) * 10n ** BigInt(d.launch.decimals - 6)
        const quote = quoteCurve(state, side, amountIn, d.launch.decimals, d.launch.quoteDecimals)
        return NextResponse.json(
          {
            block: state.block,
            graduated: state.graduated,
            reserve: Number(state.realQuoteReserve) / 10 ** d.launch.quoteDecimals,
            quoteSymbol: d.launch.quoteSymbol,
            quote: { ...quote, amountIn: quote.amountIn.toString(), amountOut: quote.amountOut.toString(), fee: quote.fee.toString(), tax: quote.tax.toString(), snipeTax: quote.snipeTax.toString() },
          },
          { headers },
        )
      }
      return NextResponse.json(d, { headers })
    }
    const feed = (q.get('feed') ?? 'new') as LaunchFeed
    if (!['new', 'trending', 'graduating', 'graduated'].includes(feed)) return NextResponse.json({ error: 'bad feed' }, { status: 400, headers })
    return NextResponse.json({ rows: launchFeed(feed, Math.min(100, Number(q.get('limit') ?? 40))), at: Date.now() }, { headers })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers })
  }
}
