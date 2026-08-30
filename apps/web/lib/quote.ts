import { makeClient, readV3Pool, type V3PoolSnapshot } from '@paperhands/chain'
import { quoteV3ExactIn, poolStateAfter, type Quote } from '@paperhands/engine'
import type { Address } from 'viem'
import { db } from './db'

const g = globalThis as unknown as {
  __phclient?: ReturnType<typeof makeClient>
  __phsnaps?: Map<string, { snap: V3PoolSnapshot; at: number }>
}
const client = (g.__phclient ??= makeClient())
const snaps = (g.__phsnaps ??= new Map())

const SNAP_TTL_MS = 10_000

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

/** Live pool snapshot, cached briefly so ticket polling doesn't hammer the RPC. */
export async function getSnapshot(pool: string): Promise<V3PoolSnapshot> {
  const key = pool.toLowerCase()
  const hit = snaps.get(key)
  if (hit && Date.now() - hit.at < SNAP_TTL_MS) return hit.snap
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

export async function ticketQuote(pool: string, side: 'buy' | 'sell', amountIn: bigint): Promise<TicketQuote> {
  const meta = poolMeta(pool)
  if (!meta) throw new Error('unknown or unpriced pool')
  const snap = await getSnapshot(pool)
  const baseIsToken0 = meta.base_is_token0 === 1
  const zeroForOne = side === 'buy' ? !baseIsToken0 : baseIsToken0
  const q = quoteV3ExactIn(snap.state, amountIn, zeroForOne)

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

  if (side === 'buy' && q.amountOut > 0n) {
    const after = poolStateAfter(snap.state, q)
    const exit = quoteV3ExactIn(after, q.amountOut, baseIsToken0)
    out.instantExit = exit.amountOut.toString()
    const spotAfterBaseInQuote = exit.spotPriceBefore // sell-direction spot = quote per base, raw
    const mark = Number(q.amountOut) * spotAfterBaseInQuote
    out.markInflation = Number(exit.amountOut) > 0 ? mark / Number(exit.amountOut) : Infinity
  }
  return out
}
