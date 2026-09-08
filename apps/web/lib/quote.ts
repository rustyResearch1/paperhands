import { readPoolState, type PoolStateSnapshot } from '@paperhands/indexer'
import { chainClient as client } from './chain'
import { db } from './db'
import { bestFill } from './route'

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
export async function ticketQuote(
  pool: string,
  side: 'buy' | 'sell',
  amountIn: bigint,
  opts: { fresh?: boolean } = {},
): Promise<TicketQuote> {
  const meta = poolMeta(pool)
  if (!meta) throw new Error('unknown or unpriced pool')
  const r = await bestFill(meta.baseAddress, side, amountIn, { fresh: opts.fresh ?? false })

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
    },
  }
  if (r.instantExit !== undefined) out.instantExit = r.instantExit.toString()
  if (r.markInflation !== undefined) out.markInflation = r.markInflation
  return out
}
