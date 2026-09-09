import type Database from 'better-sqlite3'
import { setMeta } from './db.js'
import type { TraderTokenPnl } from './pnl.js'

export const BASKETS_META_KEY = 'baskets_json'
export const BASKETS_TS_KEY = 'baskets_ts'

/**
 * The backers leaderboard, precomputed here rather than in the web process.
 *
 * Building it means replaying every ranked wallet's cost basis and pricing its
 * bags — on a production-sized ledger that is tens of seconds of synchronous
 * SQLite, which would stall every other request in the single-threaded web
 * server. The wire refresh already replays each of these wallets, so the
 * holdings come free from that same pass and the web only reads a meta row.
 */
export interface StoredBasketHolding {
  token: string
  pool: string
  symbol: string
  decimals: number
  qty: number
  close: number
  markEth: number
  weight: number
  change7dPct: number | null
}

export interface StoredBasket {
  address: string
  rank: number
  holdings: StoredBasketHolding[]
  markEth: number
  excluded: number
  return7dPct: number | null
}

const MAX_HOLDINGS = 10
const MIN_WEIGHT = 0.01

/** Build one wallet's basket from a replay we already have in hand. */
export function basketFromTokens(db: Database.Database, address: string, rank: number, tokens: TraderTokenPnl[]): StoredBasket {
  const lastClose = db.prepare(`SELECT close, minute_ts FROM candles WHERE pool = ? ORDER BY minute_ts DESC LIMIT 1`)
  const closeAt = db.prepare(`SELECT close FROM candles WHERE pool = ? AND minute_ts >= ? ORDER BY minute_ts ASC LIMIT 1`)
  const now = Math.floor(Date.now() / 1000)
  const priced = tokens
    .map((t) => {
      const qty = Number(BigInt(t.openQtyRaw)) / 10 ** t.decimals
      if (qty <= 0) return null
      const c = lastClose.get(t.pool) as { close: number; minute_ts: number } | undefined
      // A mark is only a mark if the candle is recent and the number is sane.
      if (!c || c.close <= 0 || now - c.minute_ts > 7 * 86_400) return null
      const markEth = qty * c.close
      if (!Number.isFinite(markEth) || markEth <= 0 || markEth >= 1e6) return null
      return { t, qty, close: c.close, markEth }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  const openBags = tokens.filter((t) => BigInt(t.openQtyRaw) > 0n).length
  const total = priced.reduce((a, x) => a + x.markEth, 0)
  const kept = priced.sort((a, b) => b.markEth - a.markEth).filter((x) => total > 0 && x.markEth / total >= MIN_WEIGHT).slice(0, MAX_HOLDINGS)
  const keptTotal = kept.reduce((a, x) => a + x.markEth, 0)
  const holdings: StoredBasketHolding[] = kept.map((x) => {
    const then = closeAt.get(x.t.pool, now - 7 * 86_400) as { close: number } | undefined
    return {
      token: x.t.token,
      pool: x.t.pool,
      symbol: x.t.symbol,
      decimals: x.t.decimals,
      qty: x.qty,
      close: x.close,
      markEth: x.markEth,
      weight: keptTotal > 0 ? x.markEth / keptTotal : 0,
      change7dPct: then && then.close > 0 ? (x.close / then.close - 1) * 100 : null,
    }
  })
  return { address, rank, holdings, markEth: keptTotal, excluded: openBags - holdings.length, return7dPct: basketReturn(holdings) }
}

/**
 * A fixed basket's return over the window, from the holdings alone: with the
 * quantities constant, value_then / value_now = Σ wᵢ / (1 + rᵢ). No price
 * series needed — only the per-holding change already computed above.
 */
export function basketReturn(holdings: StoredBasketHolding[]): number | null {
  const priced = holdings.filter((h) => h.change7dPct !== null && h.change7dPct > -100)
  if (priced.length === 0) return null
  const weight = priced.reduce((a, h) => a + h.weight, 0)
  if (weight <= 0) return null
  const ratio = priced.reduce((a, h) => a + h.weight / weight / (1 + h.change7dPct! / 100), 0)
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null
  return (1 / ratio - 1) * 100
}

export function storeBaskets(db: Database.Database, baskets: StoredBasket[]): void {
  setMeta(db, BASKETS_META_KEY, JSON.stringify(baskets))
  setMeta(db, BASKETS_TS_KEY, String(Math.floor(Date.now() / 1000)))
}
