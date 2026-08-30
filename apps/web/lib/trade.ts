import { applyBuy, applySell, type Position } from '@paperhands/engine'
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

/** Thrown inside the transaction to surface a clean rejection to the caller. */
class TradeRejected extends Error {}

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

  const now = Math.floor(Date.now() / 1000)

  const tx = db.transaction((): { balance: bigint; positionQty: bigint } => {
    const user = db.prepare('SELECT balance_quote FROM users WHERE id = ?').get(userId) as
      | { balance_quote: string }
      | undefined
    if (!user) throw new TradeRejected('No paper account. Reload the page.')
    const balance = BigInt(user.balance_quote)

    const row = db
      .prepare('SELECT qty, cost_quote, realized_quote FROM positions WHERE user_id = ? AND pool = ?')
      .get(userId, poolKey) as { qty: string; cost_quote: string; realized_quote: string } | undefined
    const pos: Position = {
      qty: BigInt(row?.qty ?? '0'),
      costQuote: BigInt(row?.cost_quote ?? '0'),
      realizedQuote: BigInt(row?.realized_quote ?? '0'),
    }

    let newBalance: bigint
    let newPos: Position
    if (side === 'buy') {
      if (balance < consumed) throw new TradeRejected('Not enough paper ETH in your bankroll.')
      newBalance = balance - consumed
      newPos = applyBuy(pos, amountOut, consumed)
    } else {
      if (pos.qty < consumed) throw new TradeRejected('You cannot sell more than your position.')
      newBalance = balance + amountOut
      newPos = applySell(pos, consumed, amountOut)
    }

    db.prepare('UPDATE users SET balance_quote = ? WHERE id = ?').run(newBalance.toString(), userId)
    db.prepare(
      `INSERT INTO positions(user_id, pool, qty, cost_quote, realized_quote) VALUES(?,?,?,?,?)
       ON CONFLICT(user_id, pool) DO UPDATE SET
         qty = excluded.qty, cost_quote = excluded.cost_quote, realized_quote = excluded.realized_quote`,
    ).run(userId, poolKey, newPos.qty.toString(), newPos.costQuote.toString(), newPos.realizedQuote.toString())

    db.prepare(
      `INSERT INTO paper_trades(user_id, pool, side, qty, quote_amount, fee_quote, price_impact_bps, fill_ratio, spot_price, exec_price, block, ts)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      userId,
      poolKey,
      side,
      side === 'buy' ? amountOut.toString() : consumed.toString(),
      side === 'buy' ? consumed.toString() : amountOut.toString(),
      feeQuote.toString(),
      quote.priceImpactBps,
      quote.fillRatio,
      quote.spotPrice,
      quote.execPrice,
      Number(quote.block),
      now,
    )
    return { balance: newBalance, positionQty: newPos.qty }
  })

  try {
    const r = tx()
    return { ok: true, quote, balance: r.balance.toString(), positionQty: r.positionQty.toString() }
  } catch (err) {
    if (err instanceof TradeRejected) return { ok: false, error: err.message }
    throw err
  }
}
