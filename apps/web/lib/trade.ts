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
 * Execute a paper trade at live pool state. Buys spend WETH wei; sells spend
 * base-token raw units. Fills use the engine's honest simulation — partial
 * fills are rejected outright rather than pretending the pool absorbed you.
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

  const user = db.prepare('SELECT balance_quote FROM users WHERE id = ?').get(userId) as
    | { balance_quote: string }
    | undefined
  if (!user) return { ok: false, error: 'No paper account. Reload the page.' }

  const pos = db
    .prepare('SELECT qty, cost_quote, realized_quote FROM positions WHERE user_id = ? AND pool = ?')
    .get(userId, pool.toLowerCase()) as { qty: string; cost_quote: string; realized_quote: string } | undefined

  if (side === 'buy' && BigInt(user.balance_quote) < amountIn) {
    return { ok: false, error: 'Not enough paper ETH in your bankroll.' }
  }
  if (side === 'sell' && (!pos || BigInt(pos.qty) < amountIn)) {
    return { ok: false, error: 'You cannot sell more than your position.' }
  }

  let quote: TicketQuote
  try {
    quote = await ticketQuote(pool, side, amountIn)
  } catch (err) {
    return { ok: false, error: `Could not read live pool state: ${(err as Error).message}` }
  }
  if (quote.fillRatio < 1) {
    return {
      ok: false,
      error: `The pool cannot absorb this size — only ${(quote.fillRatio * 100).toFixed(1)}% would fill. Trade smaller.`,
    }
  }
  const amountOut = BigInt(quote.amountOut)
  if (amountOut <= 0n) return { ok: false, error: 'This size rounds to zero output. Trade larger.' }

  const now = Math.floor(Date.now() / 1000)
  const consumed = BigInt(quote.amountIn)

  const tx = db.transaction(() => {
    if (side === 'buy') {
      const newBalance = BigInt(user.balance_quote) - consumed
      db.prepare('UPDATE users SET balance_quote = ? WHERE id = ?').run(newBalance.toString(), userId)
      const qty = (pos ? BigInt(pos.qty) : 0n) + amountOut
      const cost = (pos ? BigInt(pos.cost_quote) : 0n) + consumed
      db.prepare(
        `INSERT INTO positions(user_id, pool, qty, cost_quote, realized_quote) VALUES(?,?,?,?, '0')
         ON CONFLICT(user_id, pool) DO UPDATE SET qty = excluded.qty, cost_quote = excluded.cost_quote`,
      ).run(userId, pool.toLowerCase(), qty.toString(), cost.toString())
    } else {
      const held = BigInt(pos!.qty)
      const cost = BigInt(pos!.cost_quote)
      const basisRemoved = (cost * consumed) / held
      const realized = BigInt(pos!.realized_quote) + amountOut - basisRemoved
      const newQty = held - consumed
      const newBalance = BigInt(user.balance_quote) + amountOut
      db.prepare('UPDATE users SET balance_quote = ? WHERE id = ?').run(newBalance.toString(), userId)
      if (newQty === 0n) {
        // keep the row so realized PnL survives a full exit
        db.prepare('UPDATE positions SET qty = ?, cost_quote = ?, realized_quote = ? WHERE user_id = ? AND pool = ?').run(
          '0',
          '0',
          realized.toString(),
          userId,
          pool.toLowerCase(),
        )
      } else {
        db.prepare('UPDATE positions SET qty = ?, cost_quote = ?, realized_quote = ? WHERE user_id = ? AND pool = ?').run(
          newQty.toString(),
          (cost - basisRemoved).toString(),
          realized.toString(),
          userId,
          pool.toLowerCase(),
        )
      }
    }

    db.prepare(
      `INSERT INTO paper_trades(user_id, pool, side, qty, quote_amount, fee_quote, price_impact_bps, fill_ratio, spot_price, exec_price, block, ts)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      userId,
      pool.toLowerCase(),
      side,
      side === 'buy' ? amountOut.toString() : consumed.toString(),
      side === 'buy' ? consumed.toString() : amountOut.toString(),
      quote.feeAmount,
      quote.priceImpactBps,
      quote.fillRatio,
      quote.spotPrice,
      quote.execPrice,
      Number(quote.block),
      now,
    )
  })
  tx()

  const balance = (db.prepare('SELECT balance_quote FROM users WHERE id = ?').get(userId) as { balance_quote: string })
    .balance_quote
  const newPos = db
    .prepare('SELECT qty FROM positions WHERE user_id = ? AND pool = ?')
    .get(userId, pool.toLowerCase()) as { qty: string } | undefined

  return { ok: true, quote, balance, positionQty: newPos?.qty ?? '0' }
}
