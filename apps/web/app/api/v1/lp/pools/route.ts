import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { isXChain } from '@/lib/x'
import { lpScreen } from '@/lib/x/lp'
import type { XChain } from '@/lib/x/types'

export const maxDuration = 60

/**
 * GET /api/v1/lp/pools?chains=rh,sol,bsc&limit=40
 * The LP screener: pools across Robinhood Chain, Solana (Orca, Meteora) and
 * BNB Chain (PancakeSwap v3) with 24h fee yield, volume/TVL, realized σ and
 * the fee-to-vol score, plus suggested ranges (1σ / 2σ / 4σ).
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 20)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const q = req.nextUrl.searchParams
  const chains = (q.get('chains') ?? 'rh,sol,bsc').split(',').filter(isXChain) as XChain[]
  const limit = Math.min(120, Math.max(5, Number(q.get('limit') ?? 40)))
  try {
    const s = await lpScreen(chains.length ? chains : ['rh', 'sol', 'bsc'])
    return NextResponse.json({ ...s, rows: s.rows.slice(0, limit) }, { headers: limitHeaders(rl) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers: limitHeaders(rl) })
  }
}
