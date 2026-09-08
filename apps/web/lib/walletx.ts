import { traderPnlSummary, traderTokenPnl, type TraderTokenPnl } from '@paperhands/indexer'
import { db } from './db'

/**
 * Wallet explorer for Robinhood Chain, from our own ledger. The cost-basis
 * replay lives in the indexer (shared with the Wire ranking); this layer adds
 * marks, sanity checks and the swap timeline. Open bags are valued on the
 * client, one best-route quote each, so the page never waits on the RPC.
 */
export interface TokenPnl extends TraderTokenPnl {
  openQty: number
  avgEntry: number | null
  lastClose: number | null
  /** Chart-price value of the open bag — the number we refuse to trust. */
  markEth: number
}

export interface WalletSummary {
  address: string
  trades: number
  buys: number
  sells: number
  volEth: number
  ethIn: number
  ethOut: number
  netFlow: number
  realized: number
  openCost: number
  markOpen: number
  winRate: number | null
  wins: number
  losses: number
  bestSymbol: string | null
  worstSymbol: string | null
  closedTokens: number
  firstTs: number | null
  lastTs: number | null
  rank: number | null
  tokens: TokenPnl[]
}

const cache = new Map<string, { at: number; v: WalletSummary }>()

export function walletSummary(address: string): WalletSummary {
  const key = address.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return hit.v

  const base = traderTokenPnl(db, key)
  const closeStmt = db.prepare(`SELECT close, minute_ts FROM candles WHERE pool = ? ORDER BY minute_ts DESC LIMIT 1`)
  const now = Math.floor(Date.now() / 1000)
  const tokens: TokenPnl[] = base.map((t) => {
    const openQty = Number(BigInt(t.openQtyRaw)) / 10 ** t.decimals
    const c = closeStmt.get(t.pool) as { close: number; minute_ts: number } | undefined
    // A mark is only a mark if the candle is recent and the number is sane.
    const close = c && now - c.minute_ts < 7 * 86_400 && c.close > 0 ? c.close : null
    const mark = close && openQty > 0 ? openQty * close : 0
    return { ...t, openQty, avgEntry: openQty > 0 && t.openCost > 0 ? t.openCost / openQty : null, lastClose: close, markEth: Number.isFinite(mark) && mark < 1e6 ? mark : 0 }
  })
  tokens.sort((a, b) => b.realized - a.realized)
  const s = traderPnlSummary(base)
  const span = db.prepare(`SELECT MIN(ts) AS a, MAX(ts) AS b, COUNT(*) AS n FROM swaps WHERE trader = ?`).get(key) as { a: number | null; b: number | null; n: number }
  const rank = (db.prepare(`SELECT rank FROM wire_rank WHERE trader = ?`).get(key) as { rank: number } | undefined)?.rank ?? null
  const v: WalletSummary = {
    address: key,
    trades: span.n,
    buys: tokens.reduce((a, t) => a + t.buys, 0),
    sells: tokens.reduce((a, t) => a + t.sells, 0),
    volEth: tokens.reduce((a, t) => a + t.ethIn + t.ethOut, 0),
    ethIn: tokens.reduce((a, t) => a + t.ethIn, 0),
    ethOut: tokens.reduce((a, t) => a + t.ethOut, 0),
    netFlow: tokens.reduce((a, t) => a + t.ethOut - t.ethIn, 0),
    realized: s.realized,
    openCost: s.openCost,
    markOpen: tokens.reduce((a, t) => a + t.markEth, 0),
    winRate: s.winRate,
    wins: s.wins,
    losses: s.losses,
    bestSymbol: s.bestSymbol,
    worstSymbol: s.worstSymbol,
    closedTokens: s.wins + s.losses + tokens.filter((t) => t.sells > 0 && t.realized === 0).length,
    firstTs: span.a,
    lastTs: span.b,
    rank,
    tokens,
  }
  cache.set(key, { at: Date.now(), v })
  return v
}

export interface SwapLine {
  ts: number
  tx: string
  pool: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  eth: number
  /** ETH per token on this fill. */
  price: number | null
}

interface SwapRow {
  pool: string
  ts: number
  tx_hash: string
  amount0: string
  amount1: string
  base_is_token0: number
  symbol: string
  decimals: number
}

export function walletSwapLines(address: string, page = 1, size = 60): { lines: SwapLine[]; total: number } {
  const key = address.toLowerCase()
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM swaps WHERE trader = ?`).get(key) as { n: number }).n
  const rows = db
    .prepare(
      `SELECT s.pool, s.ts, s.tx_hash, s.amount0, s.amount1, p.base_is_token0, tb.symbol AS symbol, tb.decimals AS decimals
       FROM swaps s
       JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader = ? AND p.base_is_token0 IS NOT NULL AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
       ORDER BY s.block DESC, s.log_index DESC LIMIT ? OFFSET ?`,
    )
    .all(key, size, (page - 1) * size) as SwapRow[]
  return {
    total,
    lines: rows.map((r) => {
      const eth = Number(r.base_is_token0 === 1 ? r.amount1 : r.amount0) / 1e18
      const qty = Math.abs(Number(r.base_is_token0 === 1 ? r.amount0 : r.amount1)) / 10 ** r.decimals
      return { ts: r.ts, tx: r.tx_hash, pool: r.pool, symbol: r.symbol, side: eth > 0 ? 'buy' : 'sell', qty, eth: Math.abs(eth), price: qty > 0 ? Math.abs(eth) / qty : null }
    }),
  }
}
