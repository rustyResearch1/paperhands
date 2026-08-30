import { applyBuy, applySell, type Position } from '@paperhands/engine'
import type Database from 'better-sqlite3'

/** A rejection that should surface to the user as a message, not a stack trace. */
export class LedgerRejected extends Error {}

export interface SettleParams {
  userId: string
  pool: string
  side: 'buy' | 'sell'
  /** Input consumed: WETH wei for buys, base raw units for sells. */
  consumed: bigint
  amountOut: bigint
  /** Fee in quote units (sells must pre-convert from base units). */
  feeQuote: bigint
  priceImpactBps: number
  fillRatio: number
  spotPrice: number
  execPrice: number
  block: number
  ts: number
  /** 'manual' for user-clicked trades, 'tail:<wallet>' for mirrored fills. */
  source: string
}

/**
 * The one place a paper trade settles: balance, position (via the engine's
 * tested average-cost accounting), and the trade row — all inside a single
 * synchronous transaction so checks and writes cannot interleave.
 */
export function settlePaperTrade(
  db: Database.Database,
  p: SettleParams,
): { balance: bigint; positionQty: bigint } {
  const poolKey = p.pool.toLowerCase()
  const tx = db.transaction((): { balance: bigint; positionQty: bigint } => {
    const user = db.prepare('SELECT balance_quote FROM users WHERE id = ?').get(p.userId) as
      | { balance_quote: string }
      | undefined
    if (!user) throw new LedgerRejected('No paper account.')
    const balance = BigInt(user.balance_quote)

    const row = db
      .prepare('SELECT qty, cost_quote, realized_quote FROM positions WHERE user_id = ? AND pool = ?')
      .get(p.userId, poolKey) as { qty: string; cost_quote: string; realized_quote: string } | undefined
    const pos: Position = {
      qty: BigInt(row?.qty ?? '0'),
      costQuote: BigInt(row?.cost_quote ?? '0'),
      realizedQuote: BigInt(row?.realized_quote ?? '0'),
    }

    let newBalance: bigint
    let newPos: Position
    if (p.side === 'buy') {
      if (balance < p.consumed) throw new LedgerRejected('Not enough paper ETH in the bankroll.')
      newBalance = balance - p.consumed
      newPos = applyBuy(pos, p.amountOut, p.consumed)
    } else {
      if (pos.qty < p.consumed) throw new LedgerRejected('Cannot sell more than the position.')
      newBalance = balance + p.amountOut
      newPos = applySell(pos, p.consumed, p.amountOut)
    }

    db.prepare('UPDATE users SET balance_quote = ? WHERE id = ?').run(newBalance.toString(), p.userId)
    db.prepare(
      `INSERT INTO positions(user_id, pool, qty, cost_quote, realized_quote) VALUES(?,?,?,?,?)
       ON CONFLICT(user_id, pool) DO UPDATE SET
         qty = excluded.qty, cost_quote = excluded.cost_quote, realized_quote = excluded.realized_quote`,
    ).run(p.userId, poolKey, newPos.qty.toString(), newPos.costQuote.toString(), newPos.realizedQuote.toString())
    db.prepare(
      `INSERT INTO paper_trades(user_id, pool, side, qty, quote_amount, fee_quote, price_impact_bps, fill_ratio, spot_price, exec_price, block, ts, source)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      p.userId,
      poolKey,
      p.side,
      p.side === 'buy' ? p.amountOut.toString() : p.consumed.toString(),
      p.side === 'buy' ? p.consumed.toString() : p.amountOut.toString(),
      p.feeQuote.toString(),
      p.priceImpactBps,
      p.fillRatio,
      p.spotPrice,
      p.execPrice,
      p.block,
      p.ts,
      p.source,
    )
    return { balance: newBalance, positionQty: newPos.qty }
  })
  return tx()
}
