import { NextRequest, NextResponse } from 'next/server'
import { ticketQuote } from '@/lib/quote'

export async function GET(req: NextRequest) {
  const pool = req.nextUrl.searchParams.get('pool')
  const side = req.nextUrl.searchParams.get('side')
  const amount = req.nextUrl.searchParams.get('amount')
  if (!pool || (side !== 'buy' && side !== 'sell') || !amount) {
    return NextResponse.json({ error: 'pool, side (buy|sell) and amount are required' }, { status: 400 })
  }
  let amountIn: bigint
  try {
    amountIn = BigInt(amount)
  } catch {
    return NextResponse.json({ error: 'amount must be an integer in raw units' }, { status: 400 })
  }
  if (amountIn <= 0n) return NextResponse.json({ error: 'amount must be positive' }, { status: 400 })
  try {
    const q = await ticketQuote(pool, side, amountIn)
    return NextResponse.json(q)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
