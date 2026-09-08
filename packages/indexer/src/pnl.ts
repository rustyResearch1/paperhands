import type Database from 'better-sqlite3'

/**
 * Trader P&L from attributed swaps, replayed in order with a pro-rata cost
 * basis. Realized = ETH banked on sells minus the cost of what was sold;
 * the open bag keeps the rest of the cost. Only ETH-quoted, factory-verified
 * pools count; stablecoin and WETH legs are excluded as cash, not bets.
 */
export interface TraderTokenPnl {
  token: string
  pool: string
  symbol: string
  decimals: number
  buys: number
  sells: number
  ethIn: number
  ethOut: number
  realized: number
  /** Raw token units still held (integer as string). */
  openQtyRaw: string
  openCost: number
  firstTs: number
  lastTs: number
  /** Sold more than the ledger saw bought — cost basis is understated. */
  untracked: boolean
}

interface Row {
  pool: string
  ts: number
  amount0: string
  amount1: string
  base_is_token0: number
  symbol: string
  decimals: number
  baseAddr: string
}

const CASH = new Set(['USDG', 'USDE', 'WETH', 'USDC', 'USDT'])

export function traderTokenPnl(db: Database.Database, trader: string): TraderTokenPnl[] {
  const rows = db
    .prepare(
      `SELECT s.pool, s.ts, s.amount0, s.amount1, p.base_is_token0,
              tb.symbol AS symbol, tb.decimals AS decimals, tb.address AS baseAddr
       FROM swaps s
       JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader = ? AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
       ORDER BY s.block ASC, s.log_index ASC`,
    )
    .all(trader.toLowerCase()) as Row[]
  const by = new Map<string, TraderTokenPnl & { qty: number }>()
  for (const r of rows) {
    if (CASH.has(r.symbol.toUpperCase())) continue
    const eth = Number(r.base_is_token0 === 1 ? r.amount1 : r.amount0) / 1e18
    const base = Number(r.base_is_token0 === 1 ? r.amount0 : r.amount1)
    let t = by.get(r.baseAddr)
    if (!t) {
      t = { token: r.baseAddr, pool: r.pool, symbol: r.symbol, decimals: r.decimals, buys: 0, sells: 0, ethIn: 0, ethOut: 0, realized: 0, openQtyRaw: '0', openCost: 0, firstTs: r.ts, lastTs: r.ts, untracked: false, qty: 0 }
      by.set(r.baseAddr, t)
    }
    t.firstTs = Math.min(t.firstTs, r.ts)
    t.lastTs = Math.max(t.lastTs, r.ts)
    if (eth > 0) {
      t.buys++
      t.ethIn += eth
      t.qty += -base
      t.openCost += eth
    } else if (eth < 0) {
      t.sells++
      const out = -eth
      t.ethOut += out
      if (t.qty <= 0) {
        t.realized += out
        t.untracked = true
      } else {
        const portion = Math.min(1, base / t.qty)
        const costOut = t.openCost * portion
        t.realized += out - costOut
        t.openCost -= costOut
        t.qty = Math.max(0, t.qty - base)
      }
    }
  }
  return [...by.values()].map(({ qty, ...t }) => ({ ...t, openQtyRaw: BigInt(Math.floor(Math.max(0, qty))).toString() }))
}

export interface TraderPnlSummary {
  realized: number
  wins: number
  losses: number
  winRate: number | null
  bestSymbol: string | null
  worstSymbol: string | null
  openCost: number
}

export function traderPnlSummary(tokens: TraderTokenPnl[]): TraderPnlSummary {
  const closed = tokens.filter((t) => t.sells > 0)
  const wins = closed.filter((t) => t.realized > 0)
  const losses = closed.filter((t) => t.realized < 0)
  const best = closed.length ? closed.reduce((a, b) => (b.realized > a.realized ? b : a)) : null
  const worst = closed.length ? closed.reduce((a, b) => (b.realized < a.realized ? b : a)) : null
  return {
    realized: tokens.reduce((a, t) => a + t.realized, 0),
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    bestSymbol: best && best.realized > 0 ? best.symbol : null,
    worstSymbol: worst && worst.realized < 0 ? worst.symbol : null,
    openCost: tokens.reduce((a, t) => a + t.openCost, 0),
  }
}
