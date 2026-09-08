import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { bestFill } from '@/lib/route'

export const maxDuration = 30

/**
 * GET /api/v1/quote?token=0x…&side=buy|sell&amount=<raw units>[&real=1]
 * Best-fill route across every venue, exact engine math. `amount` is ETH
 * wei for buys and base-token raw units for sells.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const token = q.get('token')?.toLowerCase()
  const side = q.get('side')
  const amount = q.get('amount')
  if (!token || !/^0x[0-9a-f]{40}$/.test(token) || (side !== 'buy' && side !== 'sell') || !amount) {
    return NextResponse.json({ error: 'token, side (buy|sell) and amount are required' }, { status: 400, headers: limitHeaders(rl) })
  }
  let amountIn: bigint
  try {
    amountIn = BigInt(amount)
  } catch {
    return NextResponse.json({ error: 'amount must be an integer in raw units' }, { status: 400, headers: limitHeaders(rl) })
  }
  try {
    const r = await bestFill(token, side, amountIn, q.get('real') === '1' ? { executable: 'wallet' } : {})
    return NextResponse.json(
      {
        token,
        side,
        amountIn: r.amountIn.toString(),
        amountOut: r.amountOut.toString(),
        fillRatio: r.fillRatio,
        exhaustedWindow: r.exhaustedWindow,
        priceImpactBps: r.priceImpactBps,
        priceMovePct: r.priceMovePct,
        feeBps: r.feeBps,
        spotRawOutPerIn: r.spotRaw,
        execRawOutPerIn: r.execRaw,
        instantExit: r.instantExit?.toString() ?? null,
        markInflation: r.markInflation ?? null,
        exact: r.exact,
        legs: r.legs.map((l) => ({
          pool: l.venue.pool,
          version: l.venue.version,
          fee: l.venue.fee,
          hooked: l.venue.hooked,
          tokenIn: l.side === 'buy' ? l.venue.quoteAddress : l.venue.baseAddress,
          tokenOut: l.side === 'buy' ? l.venue.baseAddress : l.venue.quoteAddress,
          amountIn: l.amountIn.toString(),
          amountOut: l.amountOut.toString(),
          priceImpactBps: l.priceImpactBps,
        })),
      },
      { headers: limitHeaders(rl) },
    )
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers: limitHeaders(rl) })
  }
}
