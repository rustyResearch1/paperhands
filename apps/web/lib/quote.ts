import { readPoolState, type PoolStateSnapshot } from '@paperhands/indexer'
import { chainClient as client } from './chain'
import { db } from './db'
import { bestFill, walletSignable } from './route'
import { coalesce, quoteSemaphore } from './x/limits'

export { chainClient } from './chain'

const g = globalThis as unknown as {
  __phsnaps?: Map<string, { snap: PoolStateSnapshot; at: number }>
}
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
  hooks: string | null
  baseSymbol: string
  baseName: string
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
              tb.symbol AS baseSymbol, tb.name AS baseName, tb.decimals AS baseDecimals, tb.address AS baseAddress,
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
  /** How the order was routed — the venue(s) that gave the best fill. */
  route: {
    label: string
    legs: string[]
    venuePool: string
    version: number
    hooked: boolean
    twoLeg: boolean
    /** Every leg quoted by our engine (false = a hooked pool quoted on-chain). */
    exact: boolean
    /** Per-leg execution details (token addresses, fee, v4 pool key), in swap order. */
    exec: { version: number; pool: string; tokenIn: string; tokenOut: string; fee: number; tickSpacing: number; hooks: string }[]
    /** True when one wallet transaction can sign this route (hookless v3, or all-v4). */
    executable: boolean
  }
}

/** Raw out-per-in ratios → human ETH-per-base. */
function humanPrices(spotRaw: number, execRaw: number, side: 'buy' | 'sell', baseDecimals: number) {
  const scale = 10 ** (baseDecimals - 18)
  if (side === 'buy') {
    return {
      spotPrice: spotRaw > 0 ? (1 / spotRaw) * scale : 0,
      execPrice: execRaw > 0 ? (1 / execRaw) * scale : 0,
    }
  }
  return { spotPrice: spotRaw * scale, execPrice: execRaw * scale }
}

/**
 * Quote a trade for the token this pool page represents — routed across
 * every venue the token has (v3 tiers, v4 pools, 2-leg via USDG), filling
 * on the best. The ledger stays ETH-denominated: routes always start
 * (buy) or end (sell) in ETH.
 */
export function ticketQuote(pool: string, side: 'buy' | 'sell', amountIn: bigint, opts: { fresh?: boolean; real?: boolean } = {}): Promise<TicketQuote> {
  // Concurrent identical tickets share one computation; fresh (execution)
  // quotes bypass the share but still take a concurrency slot.
  const run = () => quoteSemaphore.run(() => ticketQuoteInner(pool, side, amountIn, opts))
  return opts.fresh ? run() : coalesce(`ticket:${pool.toLowerCase()}:${side}:${amountIn}:${opts.real ? 1 : 0}`, run)
}

async function ticketQuoteInner(pool: string, side: 'buy' | 'sell', amountIn: bigint, opts: { fresh?: boolean; real?: boolean }): Promise<TicketQuote> {
  const meta = poolMeta(pool)
  if (!meta) throw new Error('unknown or unpriced pool')
  const r = await bestFill(meta.baseAddress, side, amountIn, {
    fresh: opts.fresh ?? false,
    ...(opts.real ? { executable: 'wallet' as const } : {}),
  })

  const legLabel = (v: { version: number; quoteSymbol: string; baseSymbol: string; fee: number; hooked: boolean }) =>
    `v${v.version} ${v.quoteSymbol}/${v.baseSymbol} ${v.fee >= 0x800000 ? 'dyn' : `${(v.fee / 10_000).toFixed(2)}%`}${v.hooked ? ' ⚓' : ''}`
  const legs = r.legs.map((l) => legLabel(l.venue))

  const out: TicketQuote = {
    side,
    amountIn: r.amountIn.toString(),
    amountOut: r.amountOut.toString(),
    feeAmount: r.feeAmount.toString(),
    fillRatio: r.fillRatio,
    exhaustedWindow: r.exhaustedWindow,
    priceImpactBps: r.priceImpactBps,
    priceMovePct: r.priceMovePct,
    feeBps: r.feeBps,
    ...humanPrices(r.spotRaw, r.execRaw, side, meta.baseDecimals),
    block: '0',
    route: {
      label: legs.join(' → '),
      legs,
      venuePool: r.baseVenue.pool,
      version: r.baseVenue.version,
      hooked: r.baseVenue.hooked,
      twoLeg: r.twoLeg,
      exact: r.exact,
      exec: r.legs.map((l) => ({
        version: l.venue.version,
        pool: l.venue.pool,
        tokenIn: l.side === 'buy' ? l.venue.quoteAddress : l.venue.baseAddress,
        tokenOut: l.side === 'buy' ? l.venue.baseAddress : l.venue.quoteAddress,
        fee: l.venue.fee,
        tickSpacing: l.venue.tickSpacing,
        hooks: l.venue.hooks,
      })),
      executable: walletSignable(r.legs),
    },
  }
  if (r.instantExit !== undefined) out.instantExit = r.instantExit.toString()
  if (r.markInflation !== undefined) out.markInflation = r.markInflation
  return out
}
