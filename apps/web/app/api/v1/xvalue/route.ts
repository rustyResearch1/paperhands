import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { isXChain, validTokenAddress, xquote, xtoken } from '@/lib/x'

export const maxDuration = 60

interface Row {
  token: string
  amount: string
  symbol: string
  decimals: number
  realizable: string | null
  fillRatio?: number
  source?: string
  route?: string
  error?: string
}
/** A bag's full-size exit quote is good for a minute — spare the RPC on revisits. */
const valueCache = new Map<string, { at: number; row: Row }>()

/**
 * POST /api/v1/xvalue { chain, holdings: [{ token, amount }] }
 * What the venue would actually pay for each bag right now — a full-size
 * sell quote per token, not the chart price. Up to 15 tokens per call.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 20)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  let body: { chain?: string; holdings?: { token: string; amount: string }[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'json body required' }, { status: 400, headers: limitHeaders(rl) })
  }
  const { chain } = body
  if (!isXChain(chain) || !Array.isArray(body.holdings)) return NextResponse.json({ error: 'chain and holdings required' }, { status: 400, headers: limitHeaders(rl) })
  const holdings = body.holdings.filter((h) => validTokenAddress(chain, h.token) && /^\d+$/.test(h.amount) && BigInt(h.amount) > 0n).slice(0, 15)
  const rows = await Promise.all(
    holdings.map(async (h) => {
      const key = `${chain}:${h.token.toLowerCase()}:${h.amount}`
      const hit = valueCache.get(key)
      if (hit && Date.now() - hit.at < 60_000) return hit.row
      const meta = await xtoken(chain, h.token).catch(() => null)
      let row: Row
      try {
        const q = await xquote(chain, 'sell', h.token, BigInt(h.amount))
        row = { token: h.token, amount: h.amount, symbol: meta?.symbol ?? h.token.slice(0, 6), decimals: meta?.decimals ?? 0, realizable: q.amountOut, fillRatio: q.fillRatio, source: q.route.source, route: q.route.label }
      } catch (err) {
        row = { token: h.token, amount: h.amount, symbol: meta?.symbol ?? h.token.slice(0, 6), decimals: meta?.decimals ?? 0, realizable: null, error: (err as Error).message.slice(0, 80) }
      }
      valueCache.set(key, { at: Date.now(), row })
      if (valueCache.size > 2000) valueCache.clear()
      return row
    }),
  )
  return NextResponse.json({ chain, rows, at: Date.now() }, { headers: limitHeaders(rl) })
}
