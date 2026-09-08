import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/session'
import { validTokenAddress } from '@/lib/x'
import { xPaperTrade, xPaperValued, type XPaperChain } from '@/lib/xpaper'

export const maxDuration = 60

const isPaperChain = (v: string | null): v is XPaperChain => v === 'sol' || v === 'bsc'

/** GET /api/xpaper?chain=sol|bsc — the paper ledger for this session on that chain, positions valued by sell quotes. */
export async function GET(req: NextRequest) {
  const chain = req.nextUrl.searchParams.get('chain')
  if (!isPaperChain(chain)) return NextResponse.json({ error: 'chain sol|bsc required' }, { status: 400 })
  const user = await getOrCreateUser()
  if (user.id === '__ephemeral') return NextResponse.json({ error: 'no session' }, { status: 401 })
  try {
    return NextResponse.json(await xPaperValued(user.id, chain))
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}

/** POST /api/xpaper { chain, side, token, amount } — paper order at a fresh quote. */
export async function POST(req: NextRequest) {
  let body: { chain?: string; side?: string; token?: string; amount?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'json body required' }, { status: 400 })
  }
  const { chain, side, token, amount } = body
  if (!isPaperChain(chain ?? null) || (side !== 'buy' && side !== 'sell') || !token || !validTokenAddress(chain as XPaperChain, token) || !amount || !/^\d+$/.test(amount)) {
    return NextResponse.json({ error: 'chain, side, token and amount are required' }, { status: 400 })
  }
  const user = await getOrCreateUser()
  if (user.id === '__ephemeral') return NextResponse.json({ error: 'no session' }, { status: 401 })
  try {
    const fill = await xPaperTrade(user.id, chain as XPaperChain, side, token, BigInt(amount))
    return NextResponse.json(fill)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 })
  }
}
