import { NextRequest, NextResponse } from 'next/server'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { bestFill } from '@/lib/route'
import { withFrozenSnapshots } from '@/lib/venues'

export const maxDuration = 30

/** Sizes in ETH that map to how trenchers actually size. */
const SIZES = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25]

const cache = new Map<string, { at: number; body: unknown }>()

/**
 * GET /api/v1/depth?token=0x…[&side=buy|sell]
 * The impact curve: best-fill output, impact, and price move at standard
 * sizes. This is what "depth" should have always meant.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 30)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  const token = req.nextUrl.searchParams.get('token')?.toLowerCase()
  const side = (req.nextUrl.searchParams.get('side') ?? 'buy') as 'buy' | 'sell'
  if (!token || !/^0x[0-9a-f]{40}$/.test(token)) return NextResponse.json({ error: 'token required' }, { status: 400, headers: limitHeaders(rl) })

  const key = `${token}:${side}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return NextResponse.json(hit.body, { headers: limitHeaders(rl) })

  // Sells are sized in base units: derive from the buy quote of the same ETH size.
  const points: { eth: number; amountIn: string; amountOut: string; priceImpactBps: number; priceMovePct: number; fillRatio: number; route: string }[] = []
  await withFrozenSnapshots(async () => {
    for (const eth of SIZES) {
      const wei = BigInt(Math.round(eth * 1e6)) * 10n ** 12n
      try {
        let amountIn = wei
        if (side === 'sell') {
          const b = await bestFill(token, 'buy', wei, { skipExit: true })
          amountIn = b.amountOut
        }
        const r = await bestFill(token, side, amountIn, { skipExit: true })
        points.push({
          eth,
          amountIn: r.amountIn.toString(),
          amountOut: r.amountOut.toString(),
          priceImpactBps: r.priceImpactBps,
          priceMovePct: r.priceMovePct,
          fillRatio: r.fillRatio,
          route: r.legs.map((l) => `v${l.venue.version}:${l.venue.pool.slice(0, 10)}`).join('>'),
        })
        if (r.fillRatio < 1 || r.exhaustedWindow) break
      } catch {
        break
      }
    }
  })
  const body = { token, side, points, generatedAt: Date.now() }
  cache.set(key, { at: Date.now(), body })
  return NextResponse.json(body, { headers: limitHeaders(rl) })
}
