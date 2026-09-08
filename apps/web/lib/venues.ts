import { UNISWAP, v4QuoterAbi, v4StateViewAbi } from '@paperhands/chain'
import { readPoolState, stateForDirection, type PoolStateSnapshot } from '@paperhands/indexer'
import { poolStateAfter, quoteV3ExactIn, type V3PoolState } from '@paperhands/engine'
import type { Address, Hex } from 'viem'
import { chainClient } from './chain'
import { db } from './db'

/**
 * A venue is one pool where a base token trades against a recognized quote
 * (WETH, native ETH, or USDG). The router quotes every venue a token has and
 * fills on the best — the way real trenchers trade through aggregators.
 */
export interface Venue {
  pool: string
  version: number
  fee: number
  tickSpacing: number
  hooks: string
  hooked: boolean
  token0: string
  token1: string
  baseIsToken0: boolean
  baseAddress: string
  baseSymbol: string
  baseDecimals: number
  quoteAddress: string
  quoteSymbol: string
  quoteDecimals: number
}

export const HOOKLESS = '0x0000000000000000000000000000000000000000'
export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

const VENUE_SQL = `
  SELECT p.address AS pool, p.version, p.fee, p.tick_spacing AS tickSpacing,
         COALESCE(p.hooks, '${HOOKLESS}') AS hooks, p.token0, p.token1, p.base_is_token0,
         tb.address AS baseAddress, tb.symbol AS baseSymbol, tb.decimals AS baseDecimals,
         tq.address AS quoteAddress, COALESCE(p.quote_symbol, 'WETH') AS quoteSymbol, tq.decimals AS quoteDecimals
  FROM pools p
  JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
  JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0 = 1 THEN p.token1 ELSE p.token0 END
  WHERE p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND p.swap_count > 0`

type VenueRow = Omit<Venue, 'hooked' | 'baseIsToken0'> & { base_is_token0: number }
const toVenue = (r: VenueRow): Venue => ({
  ...r,
  baseIsToken0: r.base_is_token0 === 1,
  hooked: r.hooks !== HOOKLESS,
})

/** Every venue where `baseAddress` trades against a recognized quote. */
export function venuesForBase(baseAddress: string): Venue[] {
  return (
    db
      .prepare(`${VENUE_SQL} AND tb.address = ? AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH','USDG')`)
      .all(baseAddress.toLowerCase()) as VenueRow[]
  ).map(toVenue)
}

/** Venues that convert ETH/WETH ↔ USDG (USDG is the base side on these pools). */
export function ethUsdgVenues(): Venue[] {
  return (
    db
      .prepare(`${VENUE_SQL} AND tb.address = ? AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH') ORDER BY p.swap_count DESC LIMIT 4`)
      .all(USDG) as VenueRow[]
  ).map(toVenue)
}

export interface VenueQuote {
  venue: Venue
  side: 'buy' | 'sell'
  amountIn: bigint
  amountOut: bigint
  /** Fee in the input token's raw units (hooked pools: estimated from the static fee). */
  feeAmount: bigint
  feeBps: number
  fillRatio: number
  exhaustedWindow: boolean
  /** Fee-excluded impact in bps (hooked pools: fee-inclusive, marked estimated). */
  priceImpactBps: number
  sqrtBefore: bigint
  /** Post-trade price; null for hooked pools quoted on-chain. */
  sqrtAfter: bigint | null
  /** Engine state after the fill, for chained (instant-exit) quotes. */
  stateAfter: V3PoolState | null
  exact: boolean
}

const g = globalThis as unknown as { __phvsnaps?: Map<string, { snap: PoolStateSnapshot; at: number }> }
const snaps = (g.__phvsnaps ??= new Map())
const TTL = 15_000

async function snapshot(pool: string, fresh: boolean): Promise<PoolStateSnapshot> {
  const hit = snaps.get(pool)
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.snap
  const snap = await readPoolState(chainClient, db, pool)
  snaps.set(pool, { snap, at: Date.now() })
  return snap
}

/**
 * Quote one venue. Hookless pools (v3 and v4) run through our validated
 * engine; hooked v4 pools go to the on-chain v4 Quoter, which executes the
 * hook — exact by construction, but opaque (no post-trade state).
 */
export async function quoteVenue(
  venue: Venue,
  side: 'buy' | 'sell',
  amountIn: bigint,
  opts: { fresh?: boolean; stateOverride?: V3PoolState } = {},
): Promise<VenueQuote> {
  const zeroForOne = side === 'buy' ? !venue.baseIsToken0 : venue.baseIsToken0

  if (!venue.hooked) {
    const snap = await snapshot(venue.pool, opts.fresh ?? false)
    const base = opts.stateOverride ?? stateForDirection(snap, zeroForOne)
    const state = opts.stateOverride ? { ...base, feePips: stateForDirection(snap, zeroForOne).feePips } : base
    const q = quoteV3ExactIn(state, amountIn, zeroForOne)
    return {
      venue,
      side,
      amountIn: q.amountIn,
      amountOut: q.amountOut,
      feeAmount: q.feeAmount,
      feeBps: q.feeBps,
      fillRatio: q.fillRatio,
      exhaustedWindow: q.exhaustedWindow,
      priceImpactBps: q.priceImpactBps,
      sqrtBefore: state.sqrtPriceX96,
      sqrtAfter: q.sqrtPriceX96After,
      stateAfter: poolStateAfter(state, q),
      exact: true,
    }
  }

  // Hooked v4: let the chain run the hook.
  const [slot0, sim] = await Promise.all([
    chainClient.readContract({
      address: UNISWAP.v4StateView as Address,
      abi: v4StateViewAbi,
      functionName: 'getSlot0',
      args: [venue.pool as Hex],
    }),
    chainClient.simulateContract({
      address: UNISWAP.v4Quoter,
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          poolKey: {
            currency0: venue.token0 as Address,
            currency1: venue.token1 as Address,
            fee: venue.fee,
            tickSpacing: venue.tickSpacing,
            hooks: venue.hooks as Address,
          },
          zeroForOne,
          exactAmount: amountIn,
          hookData: '0x',
        },
      ],
    }),
  ])
  const [sqrtBefore, , , lpFee] = slot0
  const [amountOut] = sim.result
  const p = (Number(sqrtBefore) / 2 ** 96) ** 2
  const spot = zeroForOne ? p : 1 / p
  const exec = amountIn > 0n ? Number(amountOut) / Number(amountIn) : 0
  const feePips = venue.fee >= 0x800000 ? Number(lpFee) : venue.fee
  return {
    venue,
    side,
    amountIn,
    amountOut,
    feeAmount: (amountIn * BigInt(feePips)) / 1_000_000n,
    feeBps: feePips / 100,
    fillRatio: 1,
    exhaustedWindow: false,
    priceImpactBps: spot > 0 ? Math.max(0, (1 - exec / spot) * 10_000) : 0,
    sqrtBefore,
    sqrtAfter: null,
    stateAfter: null,
    exact: true,
  }
}
