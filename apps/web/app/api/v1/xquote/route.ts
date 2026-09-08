import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { isXChain, validTokenAddress, xquote, xtoken } from '@/lib/x'

export const maxDuration = 30

/**
 * GET /api/v1/xquote?chain=rh|sol|bsc&token=<address|mint>&side=buy|sell&amount=<raw units>
 * One honest quote shape on every chain: fill, impact, route + source,
 * sold-right-back, and whether one wallet transaction can sign it.
 * `amount` is native raw units for buys (wei / lamports), token raw units for sells.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 40)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const chain = q.get('chain')
  const token = q.get('token') ?? ''
  const side = q.get('side')
  const amount = q.get('amount')
  if (!isXChain(chain) || !validTokenAddress(chain, token) || (side !== 'buy' && side !== 'sell') || !amount) {
    return NextResponse.json({ error: 'chain (rh|sol|bsc), token, side (buy|sell) and amount are required' }, { status: 400, headers: limitHeaders(rl) })
  }
  let amountIn: bigint
  try {
    amountIn = BigInt(amount)
  } catch {
    return NextResponse.json({ error: 'amount must be an integer in raw units' }, { status: 400, headers: limitHeaders(rl) })
  }
  try {
    const [quote, meta] = await Promise.all([xquote(chain, side, token, amountIn), xtoken(chain, token)])
    return NextResponse.json({ ...quote, tokenMeta: meta }, { headers: limitHeaders(rl) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers: limitHeaders(rl) })
  }
}
