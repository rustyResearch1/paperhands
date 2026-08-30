import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/session'
import { executeTrade } from '@/lib/trade'

export async function POST(req: NextRequest) {
  const user = await getOrCreateUser()
  let body: { pool?: string; side?: string; amount?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const { pool, side, amount } = body
  if (!pool || (side !== 'buy' && side !== 'sell') || !amount) {
    return NextResponse.json({ ok: false, error: 'pool, side and amount are required' }, { status: 400 })
  }
  let amountIn: bigint
  try {
    amountIn = BigInt(amount)
  } catch {
    return NextResponse.json({ ok: false, error: 'amount must be an integer in raw units' }, { status: 400 })
  }
  const result = await executeTrade(user.id, pool, side, amountIn)
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
