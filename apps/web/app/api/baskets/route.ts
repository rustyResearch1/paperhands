import { NextRequest, NextResponse } from 'next/server'
import { backersLeaderboard, basketView, closeBacking, openBacking, userBackings } from '@/lib/baskets'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { getOrCreateUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/baskets?wallet=0x…   → the wallet's basket, its 7-day series, and your backings of it
 * GET  /api/baskets?mine=1       → all your paper backings
 * GET  /api/baskets?leaderboard=1
 * POST /api/baskets {action:'back', wallet, eth} | {action:'unwind', id}
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 120)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const headers = { ...limitHeaders(rl), 'Cache-Control': 'no-store' }
  const q = req.nextUrl.searchParams
  try {
    if (q.get('leaderboard')) return NextResponse.json({ rows: await backersLeaderboard(Math.min(60, Number(q.get('limit') ?? 30))) }, { headers })
    const user = await getOrCreateUser()
    if (q.get('mine')) return NextResponse.json({ backings: user.id === '__ephemeral' ? [] : userBackings(user.id), balance: user.balance_quote }, { headers })
    const wallet = (q.get('wallet') ?? '').toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ error: 'wallet required' }, { status: 400, headers })
    const { basket, series } = await basketView(wallet, Math.min(30, Math.max(1, Number(q.get('days') ?? 7))))
    const mine = user.id === '__ephemeral' ? [] : userBackings(user.id).filter((b) => b.wallet === wallet)
    return NextResponse.json({ basket, series, mine, balance: user.balance_quote }, { headers })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers })
  }
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 30)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const headers = limitHeaders(rl)
  try {
    const user = await getOrCreateUser()
    const body = (await req.json()) as { action?: string; wallet?: string; eth?: string; id?: number }
    if (body.action === 'back') {
      const wallet = (body.wallet ?? '').toLowerCase()
      if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ error: 'wallet required' }, { status: 400, headers })
      const eth = Number(body.eth)
      if (!Number.isFinite(eth) || eth <= 0 || eth > 1000) return NextResponse.json({ error: 'amount must be between 0 and 1000 ETH' }, { status: 400, headers })
      const backing = openBacking(user.id, wallet, BigInt(Math.round(eth * 1e6)) * 10n ** 12n)
      return NextResponse.json({ ok: true, backing, backings: userBackings(user.id).filter((b) => b.wallet === wallet) }, { headers })
    }
    if (body.action === 'unwind') {
      const backing = closeBacking(user.id, Number(body.id))
      return NextResponse.json({ ok: true, backing, backings: userBackings(user.id) }, { headers })
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400, headers })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400, headers })
  }
}
