import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { orcaPoolsFor, orcaPositions, orcaRanges, planOrcaClose, planOrcaOpen } from '@/lib/x/sollp'

export const maxDuration = 60
const isKey = (v: unknown): v is string => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)

/**
 * GET  /api/lp/sol?token=<mint>   → Orca pools pairing the token with SOL
 * GET  /api/lp/sol?pool=<address> → σ-based suggested ranges
 * GET  /api/lp/sol?owner=<pubkey> → the wallet's Orca positions
 * POST /api/lp/sol { action: 'open', pool, range, sol, owner } → open-position transaction for the wallet to sign
 * POST /api/lp/sol { action: 'close', position, owner }       → close transaction(s)
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 40)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const token = q.get('token')
  const pool = q.get('pool')
  const owner = q.get('owner')
  try {
    if (isKey(owner)) return NextResponse.json({ positions: await orcaPositions(owner) }, { headers: limitHeaders(rl) })
    if (isKey(token)) return NextResponse.json({ pools: await orcaPoolsFor(token) }, { headers: limitHeaders(rl) })
    if (isKey(pool)) return NextResponse.json({ strategy: await orcaRanges(pool) }, { headers: limitHeaders(rl) })
    return NextResponse.json({ error: 'token, pool or owner required' }, { status: 400, headers: limitHeaders(rl) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers: limitHeaders(rl) })
  }
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 20)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  let body: { action?: string; pool?: string; range?: number; sol?: number; owner?: string; position?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'json body required' }, { status: 400, headers: limitHeaders(rl) })
  }
  try {
    if (body.action === 'open') {
      const range = Number(body.range)
      const sol = Number(body.sol)
      if (!isKey(body.pool) || !isKey(body.owner) || !(range >= 1 && range <= 300) || !(sol > 0 && sol <= 1000)) {
        return NextResponse.json({ error: 'pool, owner, range 1–300 and sol 0–1000 required' }, { status: 400, headers: limitHeaders(rl) })
      }
      const plan = await planOrcaOpen(body.pool, range, BigInt(Math.round(sol * 1e9)), body.owner)
      return NextResponse.json({ plan }, { headers: limitHeaders(rl) })
    }
    if (body.action === 'close') {
      if (!isKey(body.position) || !isKey(body.owner)) return NextResponse.json({ error: 'position and owner required' }, { status: 400, headers: limitHeaders(rl) })
      return NextResponse.json(await planOrcaClose(body.position, body.owner), { headers: limitHeaders(rl) })
    }
    return NextResponse.json({ error: 'action open|close required' }, { status: 400, headers: limitHeaders(rl) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 200) }, { status: 502, headers: limitHeaders(rl) })
  }
}
