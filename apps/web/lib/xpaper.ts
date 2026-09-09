import { db } from './db'
import { xquote, xtoken } from './x'
import { NATIVE, type XChain, type XQuote } from './x/types'

/**
 * Practice ledgers for Solana and BNB Chain: a paper SOL / BNB bankroll,
 * fills taken from the same quotes real orders get (Jupiter, our engine on
 * PancakeSwap, KyberSwap), positions valued at what the venue would pay.
 * The Robinhood Chain paper ledger stays where it is (ETH, exact engine).
 */
export const X_STARTING: Record<Exclude<XChain, 'rh'>, bigint> = {
  sol: 10n * 10n ** 9n, // 10 SOL
  bsc: 5n * 10n ** 18n, // 5 BNB
}

db.exec(`
  CREATE TABLE IF NOT EXISTS x_balances (user_id TEXT NOT NULL, chain TEXT NOT NULL, native_raw TEXT NOT NULL, PRIMARY KEY (user_id, chain));
  CREATE TABLE IF NOT EXISTS x_positions (
    user_id TEXT NOT NULL, chain TEXT NOT NULL, token TEXT NOT NULL, symbol TEXT NOT NULL, decimals INTEGER NOT NULL,
    qty_raw TEXT NOT NULL, cost_native_raw TEXT NOT NULL, realized_native_raw TEXT NOT NULL DEFAULT '0',
    PRIMARY KEY (user_id, chain, token)
  );
  CREATE TABLE IF NOT EXISTS x_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, chain TEXT NOT NULL, token TEXT NOT NULL, side TEXT NOT NULL,
    amount_in TEXT NOT NULL, amount_out TEXT NOT NULL, source TEXT NOT NULL, route TEXT NOT NULL, ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS x_trades_user ON x_trades(user_id, chain, ts);
`)

export type XPaperChain = Exclude<XChain, 'rh'>

export interface XPaperPosition {
  token: string
  symbol: string
  decimals: number
  qty: string
  costNative: string
  realizedNative: string
}

export interface XPaperState {
  chain: XPaperChain
  native: string
  positions: XPaperPosition[]
}

export function xPaperState(userId: string, chain: XPaperChain): XPaperState {
  const bal = db.prepare(`SELECT native_raw FROM x_balances WHERE user_id = ? AND chain = ?`).get(userId, chain) as { native_raw: string } | undefined
  const positions = db
    .prepare(
      `SELECT token, symbol, decimals, qty_raw AS qty, cost_native_raw AS costNative, realized_native_raw AS realizedNative
       FROM x_positions WHERE user_id = ? AND chain = ? AND (CAST(qty_raw AS INTEGER) > 0 OR realized_native_raw != '0') ORDER BY rowid DESC`,
    )
    .all(userId, chain) as XPaperPosition[]
  return { chain, native: bal?.native_raw ?? X_STARTING[chain].toString(), positions }
}

export interface XPaperFill {
  quote: XQuote
  state: XPaperState
}

/**
 * Execute a paper order at a fresh quote. Buys spend native; sells spend the
 * position. Partial fills are refused — the venue can't absorb it, so neither
 * do we.
 */
export async function xPaperTrade(userId: string, chain: XPaperChain, side: 'buy' | 'sell', token: string, amountIn: bigint): Promise<XPaperFill> {
  if (amountIn <= 0n) throw new Error('amount must be positive')
  const state = xPaperState(userId, chain)
  const balance = BigInt(state.native)
  const pos = state.positions.find((p) => p.token.toLowerCase() === token.toLowerCase())
  if (side === 'buy' && amountIn > balance) throw new Error(`not enough paper ${NATIVE[chain].symbol}`)
  if (side === 'sell' && (!pos || BigInt(pos.qty) < amountIn)) throw new Error('not enough of that token in the paper ledger')

  const [quote, meta] = await Promise.all([xquote(chain, side, token, amountIn), xtoken(chain, token)])
  if (!meta) throw new Error('unknown token')
  if (quote.fillRatio < 0.999999) throw new Error(`the venue can't absorb this size — only ${(quote.fillRatio * 100).toFixed(1)}% fills`)
  const out = BigInt(quote.amountOut)
  const spent = BigInt(quote.amountIn)
  const now = Math.floor(Date.now() / 1000)

  db.transaction(() => {
    // Re-read and re-check inside the transaction: the quote above was awaited,
    // and another order from the same session may have settled meanwhile.
    const fresh = xPaperState(userId, chain)
    const balance = BigInt(fresh.native)
    const pos = fresh.positions.find((p) => p.token.toLowerCase() === token.toLowerCase())
    if (side === 'buy' && spent > balance) throw new Error(`not enough paper ${NATIVE[chain].symbol}`)
    if (side === 'sell' && (!pos || BigInt(pos.qty) < spent)) throw new Error('not enough of that token in the paper ledger')
    if (side === 'buy') {
      db.prepare(`INSERT INTO x_balances (user_id, chain, native_raw) VALUES (?, ?, ?) ON CONFLICT(user_id, chain) DO UPDATE SET native_raw = excluded.native_raw`).run(
        userId,
        chain,
        (balance - spent).toString(),
      )
      const qty = (pos ? BigInt(pos.qty) : 0n) + out
      const cost = (pos ? BigInt(pos.costNative) : 0n) + spent
      db.prepare(
        `INSERT INTO x_positions (user_id, chain, token, symbol, decimals, qty_raw, cost_native_raw) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, chain, token) DO UPDATE SET qty_raw = excluded.qty_raw, cost_native_raw = excluded.cost_native_raw, symbol = excluded.symbol, decimals = excluded.decimals`,
      ).run(userId, chain, token, meta.symbol, meta.decimals, qty.toString(), cost.toString())
    } else {
      const p = pos!
      const qty = BigInt(p.qty)
      // Cost basis leaves pro rata; the difference is realized.
      const costOut = (BigInt(p.costNative) * spent) / qty
      const realized = BigInt(p.realizedNative) + (out - costOut)
      db.prepare(`INSERT INTO x_balances (user_id, chain, native_raw) VALUES (?, ?, ?) ON CONFLICT(user_id, chain) DO UPDATE SET native_raw = excluded.native_raw`).run(
        userId,
        chain,
        (balance + out).toString(),
      )
      db.prepare(`UPDATE x_positions SET qty_raw = ?, cost_native_raw = ?, realized_native_raw = ? WHERE user_id = ? AND chain = ? AND token = ?`).run(
        (qty - spent).toString(),
        (BigInt(p.costNative) - costOut).toString(),
        realized.toString(),
        userId,
        chain,
        token,
      )
    }
    db.prepare(`INSERT INTO x_trades (user_id, chain, token, side, amount_in, amount_out, source, route, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId,
      chain,
      token,
      side,
      spent.toString(),
      out.toString(),
      quote.route.source,
      quote.route.label,
      now,
    )
  })()

  return { quote, state: xPaperState(userId, chain) }
}

/** Positions with what the venue would pay for each bag right now. */
export async function xPaperValued(userId: string, chain: XPaperChain): Promise<XPaperState & { valued: (XPaperPosition & { realizable: string | null; source?: string })[]; equity: string }> {
  const state = xPaperState(userId, chain)
  const open = state.positions.filter((p) => BigInt(p.qty) > 0n).slice(0, 12)
  const valued = await Promise.all(
    open.map(async (p) => {
      try {
        const q = await xquote(chain, 'sell', p.token, BigInt(p.qty))
        return { ...p, realizable: q.fillRatio >= 0.999999 ? q.amountOut : null, source: q.route.source }
      } catch {
        return { ...p, realizable: null }
      }
    }),
  )
  const equity = BigInt(state.native) + valued.reduce((a, p) => a + (p.realizable ? BigInt(p.realizable) : 0n), 0n)
  return { ...state, valued, equity: equity.toString() }
}
