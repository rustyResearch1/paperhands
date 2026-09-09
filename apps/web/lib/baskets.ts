import { db } from './db'
import { swr, swrOrNull } from './swr'
import { walletSummary } from './walletx'

/**
 * Baskets: a wallet's open bags as a weighted index. The foundation for
 * wallet-pegged basket tokens — before any contract exists, the basket is
 * a fact read from the ledger (what the wallet holds, marked at the last
 * trade), the series is that basket priced back through our candles, and
 * "backing" is a paper position on the practice bankroll.
 *
 * Honesty notes baked into the numbers:
 * - Marks are chart prices (last candle close), not pool-would-pay fills.
 * - The series prices the CURRENT basket back in time; it is "what holding
 *   these bags would have done", not "what following this trader did".
 * - Holdings without a recent candle, or under 1% of the basket, are left out.
 */
export interface BasketHolding {
  token: string
  pool: string
  symbol: string
  decimals: number
  qty: number
  /** ETH per token, last candle. */
  close: number
  markEth: number
  weight: number
  change7dPct: number | null
}

export interface Basket {
  address: string
  rank: number | null
  markEth: number
  holdings: BasketHolding[]
  /** Bags left out (dust or unmarked). */
  excluded: number
  asOf: number
}

export interface SeriesPoint {
  ts: number
  /** Basket value in ETH at that hour, at the current quantities. */
  valueEth: number
  /** Indexed to 100 at the first point. */
  index: number
}

export interface BasketSeries {
  points: SeriesPoint[]
  returnPct: number | null
  days: number
}

db.exec(`
  CREATE TABLE IF NOT EXISTS basket_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    wallet TEXT NOT NULL,
    eth_in TEXT NOT NULL,
    opened_ts INTEGER NOT NULL,
    holdings_json TEXT NOT NULL,
    closed_ts INTEGER,
    eth_out TEXT
  );
  CREATE INDEX IF NOT EXISTS basket_positions_user ON basket_positions(user_id, closed_ts);
  CREATE INDEX IF NOT EXISTS basket_positions_wallet ON basket_positions(wallet, closed_ts);
`)

const MAX_HOLDINGS = 10
const MIN_WEIGHT = 0.01

function closeAt(pool: string, ts: number): number | null {
  const r = db.prepare(`SELECT close FROM candles WHERE pool = ? AND minute_ts >= ? ORDER BY minute_ts ASC LIMIT 1`).get(pool, ts) as { close: number } | undefined
  return r && r.close > 0 ? r.close : null
}

/** Basket + series together, cached: both walk the same candles. */
export function basketView(address: string, days = 7): Promise<{ basket: Basket; series: BasketSeries }> {
  return swr(`basket:${address.toLowerCase()}:${days}`, 60_000, async () => {
    const basket = walletBasket(address)
    return { basket, series: basketSeries(basket, days) }
  })
}

export function walletBasket(address: string): Basket {
  const w = walletSummary(address)
  const now = Math.floor(Date.now() / 1000)
  const marked = w.tokens.filter((t) => t.openQty > 0 && t.lastClose && t.markEth > 0)
  const total = marked.reduce((a, t) => a + t.markEth, 0)
  const kept = marked
    .sort((a, b) => b.markEth - a.markEth)
    .filter((t) => total > 0 && t.markEth / total >= MIN_WEIGHT)
    .slice(0, MAX_HOLDINGS)
  const keptTotal = kept.reduce((a, t) => a + t.markEth, 0)
  const holdings: BasketHolding[] = kept.map((t) => {
    const weekAgo = closeAt(t.pool, now - 7 * 86_400)
    return {
      token: t.token,
      pool: t.pool,
      symbol: t.symbol,
      decimals: t.decimals,
      qty: t.openQty,
      close: t.lastClose!,
      markEth: t.markEth,
      weight: keptTotal > 0 ? t.markEth / keptTotal : 0,
      change7dPct: weekAgo ? (t.lastClose! / weekAgo - 1) * 100 : null,
    }
  })
  return { address: w.address, rank: w.rank, markEth: keptTotal, holdings, excluded: w.tokens.filter((t) => t.openQty > 0).length - holdings.length, asOf: now }
}

/**
 * A fixed basket's return over the window, straight from the holdings: with
 * quantities held constant, value_then / value_now = Σ wᵢ / (1 + rᵢ), so the
 * return needs no price series at all — only the per-holding change the basket
 * already carries.
 */
export function basketReturnPct(basket: Basket): number | null {
  const priced = basket.holdings.filter((h) => h.change7dPct !== null && h.change7dPct > -100)
  if (priced.length === 0) return null
  const weight = priced.reduce((a, h) => a + h.weight, 0)
  if (weight <= 0) return null
  const ratio = priced.reduce((a, h) => a + (h.weight / weight) / (1 + h.change7dPct! / 100), 0)
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null
  return (1 / ratio - 1) * 100
}

/** Hourly closes for a pool since `since`, last candle of each hour, oldest first. */
function hourlyCloses(pool: string, since: number): Map<number, number> {
  // Roll up to hours in SQL: a month of minute candles for one pool is ~43k rows
  // and this runs for every holding in the basket.
  const rows = db
    .prepare(
      `SELECT (minute_ts / 3600) * 3600 AS h, close, MAX(minute_ts) AS last
       FROM candles WHERE pool = ? AND minute_ts >= ? AND close > 0
       GROUP BY h ORDER BY h ASC`,
    )
    .all(pool, since) as { h: number; close: number }[]
  return new Map(rows.map((r) => [r.h, r.close]))
}

/**
 * The current basket priced back `days` days at hourly resolution. A holding
 * with no candle yet at an hour carries its first known close (so the series
 * starts flat rather than missing), which is stated on the page.
 */
export function basketSeries(basket: Basket, days = 7): BasketSeries {
  if (basket.holdings.length === 0) return { points: [], returnPct: null, days }
  const now = Math.floor(Date.now() / 1000)
  const end = Math.floor(now / 3600) * 3600
  const start = end - days * 86_400
  const series = basket.holdings.map((h) => ({ h, closes: hourlyCloses(h.pool, start - 6 * 3600) }))
  const points: SeriesPoint[] = []
  const last = new Map<string, number>()
  for (const s of series) {
    // Seed with the earliest close we have so a young token doesn't zero the basket's history.
    const first = [...s.closes.entries()].sort((a, b) => a[0] - b[0])[0]
    if (first) last.set(s.h.token, first[1])
  }
  for (let ts = start; ts <= end; ts += 3600) {
    let value = 0
    for (const s of series) {
      const c = s.closes.get(ts)
      if (c !== undefined) last.set(s.h.token, c)
      const px = last.get(s.h.token)
      if (px !== undefined) value += s.h.qty * px
    }
    points.push({ ts, valueEth: value, index: 0 })
  }
  // Use the live mark for the final point so the series ends where the basket is now.
  const finalIdx = points.length - 1
  if (finalIdx >= 0) points[finalIdx] = { ...points[finalIdx]!, valueEth: basket.markEth }
  const base = points.find((p) => p.valueEth > 0)?.valueEth ?? 0
  for (const p of points) p.index = base > 0 ? (p.valueEth / base) * 100 : 0
  const first = points[0]?.index ?? 0
  const lastIdx = points[finalIdx]?.index ?? 0
  return { points, returnPct: first > 0 ? lastIdx - first : null, days }
}

// ---------------------------------------------------------------------------
// Paper backing on the practice bankroll (WETH wei in users.balance_quote).

export interface StoredHolding {
  token: string
  pool: string
  symbol: string
  decimals: number
  qty: number
  entryClose: number
}

export interface Backing {
  id: number
  wallet: string
  ethIn: string
  openedTs: number
  closedTs: number | null
  ethOut: string | null
  holdings: StoredHolding[]
  /** Current mark of the holdings in ETH (open positions). */
  markEth: number
  pnlEth: number
}

const WEI = 1e18

export function valueHoldings(holdings: StoredHolding[]): number {
  const stmt = db.prepare(`SELECT close FROM candles WHERE pool = ? ORDER BY minute_ts DESC LIMIT 1`)
  let v = 0
  for (const h of holdings) {
    const c = stmt.get(h.pool) as { close: number } | undefined
    v += h.qty * (c?.close ?? h.entryClose)
  }
  return v
}

export function userBackings(userId: string): Backing[] {
  const rows = db.prepare(`SELECT * FROM basket_positions WHERE user_id = ? ORDER BY id DESC LIMIT 200`).all(userId) as {
    id: number
    wallet: string
    eth_in: string
    opened_ts: number
    holdings_json: string
    closed_ts: number | null
    eth_out: string | null
  }[]
  return rows.map((r) => {
    const holdings = JSON.parse(r.holdings_json) as StoredHolding[]
    const ethIn = Number(BigInt(r.eth_in)) / WEI
    const mark = r.closed_ts ? Number(BigInt(r.eth_out ?? '0')) / WEI : valueHoldings(holdings)
    return { id: r.id, wallet: r.wallet, ethIn: r.eth_in, openedTs: r.opened_ts, closedTs: r.closed_ts, ethOut: r.eth_out, holdings, markEth: mark, pnlEth: mark - ethIn }
  })
}

export function openBacking(userId: string, wallet: string, ethWei: bigint): Backing {
  if (userId === '__ephemeral') throw new Error('Open the site normally (cookies on) to hold a paper basket.')
  if (ethWei <= 0n) throw new Error('Enter an amount above zero.')
  const basket = walletBasket(wallet)
  if (basket.holdings.length === 0) throw new Error('This wallet has no marked open bags to build a basket from.')
  const eth = Number(ethWei) / WEI
  const holdings: StoredHolding[] = basket.holdings.map((h) => ({ token: h.token, pool: h.pool, symbol: h.symbol, decimals: h.decimals, qty: (eth * h.weight) / h.close, entryClose: h.close }))
  const now = Math.floor(Date.now() / 1000)
  const id = db.transaction(() => {
    const row = db.prepare(`SELECT balance_quote FROM users WHERE id = ?`).get(userId) as { balance_quote: string } | undefined
    if (!row) throw new Error('No practice account found.')
    const bal = BigInt(row.balance_quote)
    if (bal < ethWei) throw new Error(`Not enough paper ETH — you have ${(Number(bal) / WEI).toFixed(4)}.`)
    db.prepare(`UPDATE users SET balance_quote = ? WHERE id = ?`).run((bal - ethWei).toString(), userId)
    const r = db.prepare(`INSERT INTO basket_positions(user_id, wallet, eth_in, opened_ts, holdings_json) VALUES(?,?,?,?,?)`).run(userId, wallet.toLowerCase(), ethWei.toString(), now, JSON.stringify(holdings))
    return Number(r.lastInsertRowid)
  })()
  return { id, wallet: wallet.toLowerCase(), ethIn: ethWei.toString(), openedTs: now, closedTs: null, ethOut: null, holdings, markEth: eth, pnlEth: 0 }
}

export function closeBacking(userId: string, id: number): Backing {
  const row = db.prepare(`SELECT * FROM basket_positions WHERE id = ? AND user_id = ?`).get(id, userId) as
    | { id: number; wallet: string; eth_in: string; opened_ts: number; holdings_json: string; closed_ts: number | null }
    | undefined
  if (!row) throw new Error('No such basket position.')
  if (row.closed_ts) throw new Error('Already unwound.')
  const holdings = JSON.parse(row.holdings_json) as StoredHolding[]
  const value = valueHoldings(holdings)
  const outWei = BigInt(Math.round(value * WEI))
  const now = Math.floor(Date.now() / 1000)
  // The close is the guard: only a row that is still open can be closed, and
  // the bankroll is credited only if that UPDATE actually claimed it. Two
  // concurrent unwinds therefore pay out once, not twice.
  db.transaction(() => {
    const claimed = db
      .prepare(`UPDATE basket_positions SET closed_ts = ?, eth_out = ? WHERE id = ? AND user_id = ? AND closed_ts IS NULL`)
      .run(now, outWei.toString(), id, userId)
    if (claimed.changes !== 1) throw new Error('Already unwound.')
    const u = db.prepare(`SELECT balance_quote FROM users WHERE id = ?`).get(userId) as { balance_quote: string }
    db.prepare(`UPDATE users SET balance_quote = ? WHERE id = ?`).run((BigInt(u.balance_quote) + outWei).toString(), userId)
  })()
  const ethIn = Number(BigInt(row.eth_in)) / WEI
  return { id, wallet: row.wallet, ethIn: row.eth_in, openedTs: row.opened_ts, closedTs: now, ethOut: outWei.toString(), holdings, markEth: value, pnlEth: value - ethIn }
}

// ---------------------------------------------------------------------------
// Backers leaderboard: the ranked wallets as baskets.

export interface LeaderRow {
  address: string
  rank: number
  realizedEth: number
  winRate: number | null
  holdings: number
  top: string[]
  markEth: number
  return7dPct: number | null
  backers: number
  backedEth: number
}

/** Cached rows, or null while the first build is still running. */
export function backersLeaderboardOrNull(limit = 30): LeaderRow[] | null {
  return swrOrNull(`baskets:leaderboard:${limit}`, 120_000, () => buildLeaderboard(limit))
}

export function backersLeaderboard(limit = 30): Promise<LeaderRow[]> {
  return swr(`baskets:leaderboard:${limit}`, 120_000, () => buildLeaderboard(limit))
}

function buildLeaderboard(limit: number): Promise<LeaderRow[]> {
  return (async () => {
    const ranked = db.prepare(`SELECT trader, rank, realized_eth, win_rate FROM wire_rank ORDER BY rank ASC LIMIT ?`).all(limit) as { trader: string; rank: number; realized_eth: number; win_rate: number | null }[]
    const backing = new Map<string, { n: number; eth: number }>()
    for (const b of db.prepare(`SELECT wallet, COUNT(*) AS n, SUM(CAST(eth_in AS REAL)) AS eth FROM basket_positions WHERE closed_ts IS NULL GROUP BY wallet`).all() as { wallet: string; n: number; eth: number }[]) {
      backing.set(b.wallet, { n: b.n, eth: b.eth / WEI })
    }
    const rows: LeaderRow[] = []
    for (const r of ranked) {
      // Yield between wallets: each replay is synchronous SQLite, and thirty of
      // them back to back would hold the event loop for the whole build.
      await new Promise((resolve) => setImmediate(resolve))
      const basket = walletBasket(r.trader)
      const b = backing.get(r.trader)
      rows.push({
        address: r.trader,
        rank: r.rank,
        realizedEth: r.realized_eth,
        winRate: r.win_rate,
        holdings: basket.holdings.length,
        top: basket.holdings.slice(0, 3).map((h) => h.symbol),
        markEth: basket.markEth,
        return7dPct: basketReturnPct(basket),
        backers: b?.n ?? 0,
        backedEth: b?.eth ?? 0,
      })
    }
    return rows
  })()
}
