import type { V3PoolState } from '@paperhands/engine'
import { ethUsdgVenues, quoteVenue, venuesForBase, type Venue, type VenueQuote } from './venues'

/**
 * Best-fill routing: quote every venue a token has — direct ETH/WETH pools
 * and 2-leg paths through USDG — and fill on the best. Paper traders get
 * what an aggregator would give them, computed exactly.
 */
export interface RouteQuote {
  side: 'buy' | 'sell'
  legs: VenueQuote[]
  /** The venue that actually holds the base token. */
  baseVenue: Venue
  twoLeg: boolean
  amountIn: bigint
  amountOut: bigint
  /** Fee of the first leg in its input units (what the ledger records). */
  feeAmount: bigint
  /** Combined effective fee across legs, bps of input. */
  feeBps: number
  fillRatio: number
  exhaustedWindow: boolean
  /** Fee-excluded impact vs the combined mid, bps. */
  priceImpactBps: number
  /** Combined mid, raw out-per-in. */
  spotRaw: number
  /** Realized, raw out-per-in. */
  execRaw: number
  /** Signed % move of the base venue's price (buys positive); 0 when opaque. */
  priceMovePct: number
  /** Every leg quoted by the engine (vs on-chain quoter for hooked pools). */
  exact: boolean
  instantExit?: bigint
  markInflation?: number
}

type Overrides = Map<string, V3PoolState>

function legZeroForOne(q: VenueQuote): boolean {
  return q.side === 'buy' ? !q.venue.baseIsToken0 : q.venue.baseIsToken0
}

/** Raw out-per-in mid of a leg at a given sqrt price. */
function midOutPerIn(q: VenueQuote, sqrt: bigint): number {
  const p = (Number(sqrt) / 2 ** 96) ** 2
  return legZeroForOne(q) ? p : 1 / p
}

const complete = (legs: VenueQuote[]) => legs.every((l) => l.fillRatio === 1 && !l.exhaustedWindow)

async function bestBridge(side: 'buy' | 'sell', amountIn: bigint, fresh: boolean, ov: Overrides): Promise<VenueQuote | null> {
  const bridges = ethUsdgVenues()
  const quotes = await Promise.all(
    bridges.map((b) => quoteVenue(b, side, amountIn, { fresh, stateOverride: ov.get(b.pool) }).catch(() => null)),
  )
  const ok = quotes.filter((q): q is VenueQuote => q !== null && q.amountOut > 0n)
  if (ok.length === 0) return null
  return ok.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))[0]!
}

export async function bestFill(
  baseAddress: string,
  side: 'buy' | 'sell',
  amountIn: bigint,
  opts: { fresh?: boolean; overrides?: Overrides; skipExit?: boolean } = {},
): Promise<RouteQuote> {
  const fresh = opts.fresh ?? false
  const ov = opts.overrides ?? new Map()
  const venues = venuesForBase(baseAddress)
  if (venues.length === 0) throw new Error('no tradable venue for this token')
  const direct = venues.filter((v) => v.quoteSymbol !== 'USDG')
  const viaUsdg = venues.filter((v) => v.quoteSymbol === 'USDG')

  const routes: VenueQuote[][] = []
  const directQuotes = await Promise.all(
    direct.map((v) => quoteVenue(v, side, amountIn, { fresh, stateOverride: ov.get(v.pool) }).catch(() => null)),
  )
  for (const q of directQuotes) if (q && q.amountOut > 0n) routes.push([q])

  if (viaUsdg.length > 0) {
    if (side === 'buy') {
      const leg1 = await bestBridge('buy', amountIn, fresh, ov) // ETH → USDG
      if (leg1) {
        const leg2s = await Promise.all(
          viaUsdg.map((v) => quoteVenue(v, 'buy', leg1.amountOut, { fresh, stateOverride: ov.get(v.pool) }).catch(() => null)),
        )
        for (const q of leg2s) if (q && q.amountOut > 0n) routes.push([leg1, q])
      }
    } else {
      const leg1s = await Promise.all(
        viaUsdg.map((v) => quoteVenue(v, 'sell', amountIn, { fresh, stateOverride: ov.get(v.pool) }).catch(() => null)),
      )
      for (const leg1 of leg1s) {
        if (!leg1 || leg1.amountOut <= 0n) continue
        const leg2 = await bestBridge('sell', leg1.amountOut, fresh, ov) // USDG → ETH
        if (leg2) routes.push([leg1, leg2])
      }
    }
  }
  if (routes.length === 0) throw new Error('no venue could quote this size')

  // Prefer complete fills; among those, the most output.
  routes.sort((a, b) => {
    const ca = complete(a) ? 1 : 0
    const cb = complete(b) ? 1 : 0
    if (ca !== cb) return cb - ca
    const oa = a[a.length - 1]!.amountOut
    const ob = b[b.length - 1]!.amountOut
    return ob > oa ? 1 : ob < oa ? -1 : 0
  })
  const legs = routes[0]!
  const first = legs[0]!
  const last = legs[legs.length - 1]!
  const baseLeg = legs.find((l) => l.venue.baseAddress === baseAddress.toLowerCase()) ?? last

  const spotRaw = legs.reduce((acc, l) => acc * midOutPerIn(l, l.sqrtBefore), 1)
  const execRaw = first.amountIn > 0n ? Number(last.amountOut) / Number(first.amountIn) : 0
  const keep = legs.reduce((acc, l) => acc * (1 - l.feeBps / 10_000), 1)
  const feeBps = (1 - keep) * 10_000
  const execExFee = keep > 0 ? execRaw / keep : 0
  const priceImpactBps = spotRaw > 0 ? Math.max(0, (1 - execExFee / spotRaw) * 10_000) : 0

  let priceMovePct = 0
  if (baseLeg.sqrtAfter !== null) {
    const r = (Number(baseLeg.sqrtAfter) / Number(baseLeg.sqrtBefore)) ** 2
    priceMovePct = ((baseLeg.venue.baseIsToken0 ? r : 1 / r) - 1) * 100
  }

  const out: RouteQuote = {
    side,
    legs,
    baseVenue: baseLeg.venue,
    twoLeg: legs.length > 1,
    amountIn: first.amountIn,
    amountOut: last.amountOut,
    feeAmount: first.feeAmount,
    feeBps,
    fillRatio: Math.min(...legs.map((l) => l.fillRatio)),
    exhaustedWindow: legs.some((l) => l.exhaustedWindow),
    priceImpactBps,
    spotRaw,
    execRaw,
    priceMovePct,
    exact: legs.every((l) => l.exact),
  }

  // Instant exit: sell the bag back through the best route, against the
  // post-fill state of every engine-quoted leg we just moved.
  if (side === 'buy' && !opts.skipExit && out.amountOut > 0n) {
    const after: Overrides = new Map(ov)
    for (const l of legs) if (l.stateAfter) after.set(l.venue.pool, l.stateAfter)
    try {
      const exit = await bestFill(baseAddress, 'sell', out.amountOut, { fresh: false, overrides: after, skipExit: true })
      out.instantExit = exit.amountOut
      // Mark the bag at the post-fill mid along the same path (base → ETH).
      const midAfter = legs.reduce((acc, l) => acc * midOutPerIn(l, l.sqrtAfter ?? l.sqrtBefore), 1)
      const markQuoteRaw = midAfter > 0 ? Number(out.amountOut) / midAfter : 0
      out.markInflation = exit.amountOut > 0n ? markQuoteRaw / Number(exit.amountOut) : Infinity
    } catch {
      // exit route unavailable; ticket shows no instant-exit line
    }
  }
  return out
}
