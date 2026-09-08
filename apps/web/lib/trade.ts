import { LedgerRejected, settlePaperTrade } from '@paperhands/indexer'
import { db } from './db'
import { poolMeta, ticketQuote, type TicketQuote } from './quote'

export interface TradeResult {
  ok: true
  quote: TicketQuote
  balance: string
  positionQty: string
}

export interface TradeError {
  ok: false
  error: string
}

/**
 * Execute a paper trade. Buys spend WETH wei; sells spend base-token raw
 * units. The quote reads FRESH pool state (never the ticket-polling cache),
 * and all balance/position reads, checks, and writes happen inside one
 * synchronous SQLite transaction so concurrent requests cannot interleave
 * between check and write. Partial or window-truncated fills are rejected
 * outright rather than pretend-filled.
 */
export async function executeTrade(
  userId: string,
  pool: string,
  side: 'buy' | 'sell',
  amountIn: bigint,
): Promise<TradeResult | TradeError> {
  if (amountIn <= 0n) return { ok: false, error: 'Enter an amount above zero.' }
  const meta = poolMeta(pool)
  if (!meta) return { ok: false, error: 'This pool is not tracked or has no WETH side.' }
  if (!meta.factory_verified) {
    return { ok: false, error: 'Pool is not verified against the Uniswap factory — trading it is disabled.' }
  }
  // Hooked and USDG-quoted pools are tradable through the router: hooked
  // legs are quoted by the chain's own v4 Quoter, USDG legs bridge via ETH↔USDG.
  const poolKey = pool.toLowerCase()

  let quote: TicketQuote
  try {
    quote = await ticketQuote(pool, side, amountIn, { fresh: true })
  } catch (err) {
    return { ok: false, error: `Could not read live pool state: ${(err as Error).message}` }
  }

  const consumed = BigInt(quote.amountIn)
  const amountOut = BigInt(quote.amountOut)
  // Bigint comparison — the float fillRatio rounds to 1 for sub-2^-53 remainders.
  if (consumed !== amountIn || quote.exhaustedWindow) {
    return {
      ok: false,
      error: `The pool cannot absorb this size — only ${(quote.fillRatio * 100).toFixed(1)}% would fill. Trade smaller.`,
    }
  }
  if (amountOut <= 0n) return { ok: false, error: 'This size rounds to zero output. Trade larger.' }

  // Sell fees are charged in the base token; convert to quote units at the
  // execution rate so fee_quote stays one currency.
  const feeRaw = BigInt(quote.feeAmount)
  const feeQuote =
    side === 'buy'
      ? feeRaw
      : BigInt(Math.round(Number(feeRaw) * (consumed > 0n ? Number(amountOut) / Number(consumed) : 0)))

  try {
    const r = settlePaperTrade(db, {
      userId,
      pool: poolKey,
      side,
      consumed,
      amountOut,
      feeQuote,
      priceImpactBps: quote.priceImpactBps,
      fillRatio: quote.fillRatio,
      spotPrice: quote.spotPrice,
      execPrice: quote.execPrice,
      block: Number(quote.block),
      ts: Math.floor(Date.now() / 1000),
      source: 'manual',
    })
    return { ok: true, quote, balance: r.balance.toString(), positionQty: r.positionQty.toString() }
  } catch (err) {
    if (err instanceof LedgerRejected) return { ok: false, error: err.message }
    throw err
  }
}
