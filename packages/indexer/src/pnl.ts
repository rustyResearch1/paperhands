import type Database from 'better-sqlite3'

/**
 * Trader P&L from attributed swaps, replayed in order with a pro-rata cost
 * basis. Realized = ETH banked on sells minus the cost of what was sold;
 * the open bag keeps the rest of the cost. Only ETH-quoted, factory-verified
 * pools count; stablecoin and WETH legs are excluded as cash, not bets.
 * Every sell also yields a "close" record — the trade-by-trade feed.
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

export interface TradeClose {
  ts: number
  trader: string
  token: string
  pool: string
  symbol: string
  decimals: number
  tx: string
  qtyRaw: string
  ethOut: number
  costOut: number
  realized: number
  /** Seconds between the position's first buy and this sell. */
  heldSec: number
  /** Cost basis was unknown for (part of) this sell. */
  untracked: boolean
}

interface Row {
  pool: string
  ts: number
  tx_hash: string
  amount0: string
  amount1: string
  base_is_token0: number
  symbol: string
  decimals: number
  baseAddr: string
}

const CASH = new Set(['USDG', 'USDE', 'WETH', 'USDC', 'USDT'])

export function replayTrader(db: Database.Database, trader: string): { tokens: TraderTokenPnl[]; closes: TradeClose[] } {
  const t = trader.toLowerCase()
  const rows = db
    .prepare(
      `SELECT s.pool, s.ts, s.tx_hash, s.amount0, s.amount1, p.base_is_token0,
              tb.symbol AS symbol, tb.decimals AS decimals, tb.address AS baseAddr
       FROM swaps s
       JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader = ? AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
       ORDER BY s.block ASC, s.log_index ASC`,
    )
    .all(t) as Row[]
  const by = new Map<string, TraderTokenPnl & { qty: number; openedTs: number }>()
  const closes: TradeClose[] = []
  for (const r of rows) {
    if (CASH.has(r.symbol.toUpperCase())) continue
    const eth = Number(r.base_is_token0 === 1 ? r.amount1 : r.amount0) / 1e18
    const base = Number(r.base_is_token0 === 1 ? r.amount0 : r.amount1)
    let p = by.get(r.baseAddr)
    if (!p) {
      p = { token: r.baseAddr, pool: r.pool, symbol: r.symbol, decimals: r.decimals, buys: 0, sells: 0, ethIn: 0, ethOut: 0, realized: 0, openQtyRaw: '0', openCost: 0, firstTs: r.ts, lastTs: r.ts, untracked: false, qty: 0, openedTs: r.ts }
      by.set(r.baseAddr, p)
    }
    p.firstTs = Math.min(p.firstTs, r.ts)
    p.lastTs = Math.max(p.lastTs, r.ts)
    if (eth > 0) {
      if (p.qty <= 0) p.openedTs = r.ts
      p.buys++
      p.ethIn += eth
      p.qty += -base
      p.openCost += eth
    } else if (eth < 0) {
      p.sells++
      const out = -eth
      p.ethOut += out
      let costOut = 0
      let untracked = false
      if (p.qty <= 0) {
        untracked = true
        p.untracked = true
      } else {
        const portion = Math.min(1, base / p.qty)
        costOut = p.openCost * portion
        p.openCost -= costOut
        p.qty = Math.max(0, p.qty - base)
        if (base > p.qty + base + 1) untracked = true
      }
      p.realized += out - costOut
      closes.push({ ts: r.ts, trader: t, token: r.baseAddr, pool: r.pool, symbol: r.symbol, decimals: r.decimals, tx: r.tx_hash, qtyRaw: BigInt(Math.floor(base)).toString(), ethOut: out, costOut, realized: out - costOut, heldSec: Math.max(0, r.ts - p.openedTs), untracked })
    }
  }
  const tokens = [...by.values()].map(({ qty, openedTs, ...p }) => ({ ...p, openQtyRaw: BigInt(Math.floor(Math.max(0, qty))).toString() }))
  return { tokens, closes }
}

export function traderTokenPnl(db: Database.Database, trader: string): TraderTokenPnl[] {
  return replayTrader(db, trader).tokens
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
