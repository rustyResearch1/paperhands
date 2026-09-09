import { db } from '../db'
import type { ExecLeg } from '../execute'
import { bestFill, walletSignable } from '../route'
import type { XQuote, XToken } from './types'

/** Robinhood Chain through our own engine and best-fill router (unchanged). */
export async function rhQuote(side: 'buy' | 'sell', token: string, amountIn: bigint, opts: { signable?: boolean } = {}): Promise<XQuote> {
  // `signable` restricts the router to routes one wallet transaction can sign —
  // right for anything that becomes a transaction, wrong for read-only
  // valuation, where it discards hundreds of verified v4 pools.
  const r = await bestFill(token, side, amountIn, opts.signable === false ? {} : { executable: 'wallet' })
  const meta = rhToken(token)
  const dec = meta?.decimals ?? 18
  const scale = 10 ** (dec - 18)
  const legLabel = (l: (typeof r.legs)[number]) =>
    `v${l.venue.version} ${l.venue.quoteSymbol}/${l.venue.baseSymbol} ${l.venue.fee >= 0x800000 ? 'dyn' : `${(l.venue.fee / 10_000).toFixed(2)}%`}${l.venue.hooked ? ' ⚓' : ''}`
  const legs = r.legs.map(legLabel)
  const out: XQuote = {
    chain: 'rh',
    side,
    token,
    tokenIn: side === 'buy' ? '0x0000000000000000000000000000000000000000' : token,
    tokenOut: side === 'buy' ? token : '0x0000000000000000000000000000000000000000',
    amountIn: r.amountIn.toString(),
    amountOut: r.amountOut.toString(),
    fillRatio: r.fillRatio,
    priceImpactBps: r.priceImpactBps,
    feeBps: r.feeBps,
    spotPrice: side === 'buy' ? (r.spotRaw > 0 ? (1 / r.spotRaw) * scale : null) : r.spotRaw * scale,
    execPrice: side === 'buy' ? (r.execRaw > 0 ? (1 / r.execRaw) * scale : null) : r.execRaw * scale,
    route: { label: legs.join(' → '), legs, source: 'engine' },
    exact: r.exact,
    executable: walletSignable(r.legs),
    gasUsd: null,
    exec: {
      kind: 'rh',
      legs: r.legs.map<ExecLeg>((l) => ({
        version: l.venue.version,
        pool: l.venue.pool,
        tokenIn: l.side === 'buy' ? l.venue.quoteAddress : l.venue.baseAddress,
        tokenOut: l.side === 'buy' ? l.venue.baseAddress : l.venue.quoteAddress,
        fee: l.venue.fee,
        tickSpacing: l.venue.tickSpacing,
        hooks: l.venue.hooks,
      })),
    },
    quotedAt: Date.now(),
  }
  if (r.instantExit !== undefined) {
    out.instantExit = r.instantExit.toString()
    out.retention = Number(r.instantExit) / Number(r.amountIn)
  }
  return out
}

export function rhToken(address: string): XToken | null {
  const r = db.prepare(`SELECT address, symbol, name, decimals FROM tokens WHERE address = ?`).get(address.toLowerCase()) as
    | { address: string; symbol: string; name: string; decimals: number }
    | undefined
  return r ? { chain: 'rh', ...r } : null
}
