import { makeClient } from '@paperhands/chain'
import { readPoolState, type PoolStateSnapshot } from '@paperhands/indexer'
import { quoteV3ExactIn, roundTripV3, type Quote } from '@paperhands/engine'
import { db } from './db'

const g = globalThis as unknown as {
  __phclient?: ReturnType<typeof makeClient>
  __phsnaps?: Map<string, { snap: PoolStateSnapshot; at: number }>
}
const client = (g.__phclient ??= makeClient())
export const chainClient = client
const snaps = (g.__phsnaps ??= new Map())

const SNAP_TTL_MS = 15_000

export interface PoolMeta {
  address: string
  base_is_token0: number
  factory_verified: number
  fee: number
  version: number
  quoteSymbol: string
  hooked: boolean
  baseSymbol: string
  baseDecimals: number
  baseAddress: string
  quoteDecimals: number
}

const HOOKLESS = '0x0000000000000000000000000000000000000000'

export function poolMeta(pool: string): PoolMeta | undefined {
  const row = db
    .prepare(
      `SELECT p.address, p.base_is_token0, p.factory_verified, p.fee, p.version, p.hooks,
              COALESCE(p.quote_symbol, 'WETH') AS quoteSymbol,
              tb.symbol AS baseSymbol, tb.decimals AS baseDecimals, tb.address AS baseAddress,
              tq.decimals AS quoteDecimals
       FROM pools p
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0 = 1 THEN p.token1 ELSE p.token0 END
       WHERE p.address = ? AND p.base_is_token0 IS NOT NULL`,
    )
    .get(pool.toLowerCase()) as (Omit<PoolMeta, 'hooked'> & { hooks: string | null }) | undefined
  if (!row) return undefined
  return { ...row, hooked: Boolean(row.hooks && row.hooks !== HOOKLESS) }
}

/**
 * Live pool snapshot, cached briefly so ticket polling doesn't hammer the
 * RPC. Pass `fresh: true` on paths that execute against the state — a trade
 * filling on a 10s-old snapshot would be exploitable by anyone watching the
 * live tape.
 */
export async function getSnapshot(pool: string, opts: { fresh?: boolean } = {}): Promise<PoolStateSnapshot> {
  const key = pool.toLowerCase()
  if (!opts.fresh) {
    const hit = snaps.get(key)
    if (hit && Date.now() - hit.at < SNAP_TTL_MS) return hit.snap
  }
  const snap = await readPoolState(client, db, key)
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
  /** Signed % the order moves the pool's spot price (buys positive). */
  priceMovePct: number
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

  // How far this order shoves the pool's own price — the "mcap move" a
  // paper trade would cause if it were real. Signed: buys positive.
  const sqrtBefore = Number(snap.state.sqrtPriceX96) / 2 ** 96
  const sqrtAfter = Number(q.sqrtPriceX96After) / 2 ** 96
  const rawRatio = sqrtBefore > 0 ? (sqrtAfter / sqrtBefore) ** 2 : 1
  const priceMovePct = ((baseIsToken0 ? rawRatio : 1 / rawRatio) - 1) * 100

  const out: TicketQuote = {
    side,
    amountIn: q.amountIn.toString(),
    amountOut: q.amountOut.toString(),
    feeAmount: q.feeAmount.toString(),
    fillRatio: q.fillRatio,
    exhaustedWindow: q.exhaustedWindow,
    priceImpactBps: q.priceImpactBps,
    priceMovePct,
    feeBps: q.feeBps,
    ...humanPrices(q, side, meta.baseDecimals),
    block: snap.blockNumber.toString(),
  }
  if (instantExit !== undefined) out.instantExit = instantExit.toString()
  if (markInflation !== undefined) out.markInflation = markInflation
  return out
}
