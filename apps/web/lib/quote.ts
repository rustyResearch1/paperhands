import { makeClient, readV3Pool, type V3PoolSnapshot } from '@paperhands/chain'
import { quoteV3ExactIn, roundTripV3, type Quote } from '@paperhands/engine'
import type { Address } from 'viem'
import { db } from './db'

const g = globalThis as unknown as {
  __phclient?: ReturnType<typeof makeClient>
  __phsnaps?: Map<string, { snap: V3PoolSnapshot; at: number }>
}
const client = (g.__phclient ??= makeClient())
const snaps = (g.__phsnaps ??= new Map())

const SNAP_TTL_MS = 15_000

export interface PoolMeta {
  address: string
  base_is_token0: number
  factory_verified: number
  fee: number
  baseSymbol: string
  baseDecimals: number
  baseAddress: string
}

export function poolMeta(pool: string): PoolMeta | undefined {
  return db
    .prepare(
      `SELECT p.address, p.base_is_token0, p.factory_verified, p.fee,
              tb.symbol AS baseSymbol, tb.decimals AS baseDecimals, tb.address AS baseAddress
       FROM pools p
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE p.address = ? AND p.base_is_token0 IS NOT NULL`,
    )
    .get(pool.toLowerCase()) as PoolMeta | undefined
}

/**
 * Live pool snapshot, cached briefly so ticket polling doesn't hammer the
 * RPC. Pass `fresh: true` on paths that execute against the state — a trade
 * filling on a 10s-old snapshot would be exploitable by anyone watching the
 * live tape.
 */
export async function getSnapshot(pool: string, opts: { fresh?: boolean } = {}): Promise<V3PoolSnapshot> {
  const key = pool.toLowerCase()
  if (!opts.fresh) {
    const hit = snaps.get(key)
    if (hit && Date.now() - hit.at < SNAP_TTL_MS) return hit.snap
  }
  const snap = await readV3Pool(client, key as Address)
  snaps.set(key, { snap, at: Date.now() })
  return snap
}

export interface TicketQuote {
  side: 'buy' | 'sell'
  amountIn: string
  amountOut: string
  feeAmount: string
  fillRatio: number
  exhaustedWindow: boolean
  priceImpactBps: number
  feeBps: number
  /** quote (ETH) per base token, human units */
  spotPrice: number
  execPrice: number
  /** buy only: what an instant full exit would return, wei */
  instantExit?: string
  /** buy only: markValue/realizable right after the fill */
  markInflation?: number
  block: string
}

function humanPrices(q: Quote, side: 'buy' | 'sell', baseDecimals: number) {
  // engine prices are raw out-per-in ratios; normalize to ETH-per-base
  const scale = 10 ** (baseDecimals - 18)
  if (side === 'buy') {
    // in = ETH, out = base → out/in is base-per-ETH
    return {
      spotPrice: q.spotPriceBefore > 0 ? (1 / q.spotPriceBefore) * scale : 0,
      execPrice: q.executionPrice > 0 ? (1 / q.executionPrice) * scale : 0,
    }
  }
  return {
    spotPrice: q.spotPriceBefore * scale,
    execPrice: q.executionPrice * scale,
  }
}

export async function ticketQuote(
  pool: string,
  side: 'buy' | 'sell',
  amountIn: bigint,
  opts: { fresh?: boolean } = {},
): Promise<TicketQuote> {
  const meta = poolMeta(pool)
  if (!meta) throw new Error('unknown or unpriced pool')
  const snap = await getSnapshot(pool, opts)
  const baseIsToken0 = meta.base_is_token0 === 1

  let q: Quote
  let instantExit: bigint | undefined
  let markInflation: number | undefined
  if (side === 'buy') {
    const rt = roundTripV3(snap.state, amountIn, baseIsToken0)
    q = rt.buy
    if (q.amountOut > 0n) {
      instantExit = rt.sell.amountOut
      markInflation = rt.markInflation
    }
  } else {
    q = quoteV3ExactIn(snap.state, amountIn, baseIsToken0)
  }

  const out: TicketQuote = {
    side,
    amountIn: q.amountIn.toString(),
    amountOut: q.amountOut.toString(),
    feeAmount: q.feeAmount.toString(),
    fillRatio: q.fillRatio,
    exhaustedWindow: q.exhaustedWindow,
    priceImpactBps: q.priceImpactBps,
    feeBps: q.feeBps,
    ...humanPrices(q, side, meta.baseDecimals),
    block: snap.blockNumber.toString(),
  }
  if (instantExit !== undefined) out.instantExit = instantExit.toString()
  if (markInflation !== undefined) out.markInflation = markInflation
  return out
}
