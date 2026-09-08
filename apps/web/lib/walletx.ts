import { db } from './db'
import { bestFill } from './route'

/**
 * Wallet explorer for Robinhood Chain, from our own ledger: every attributed
 * swap in ETH-quoted, factory-verified pools, replayed in order with a
 * pro-rata cost basis so each token shows realized profit (ETH actually
 * banked minus the cost of what was sold) and unrealized profit (what the
 * pool would pay for the open bag minus its cost) — never a marked price.
 */
interface SwapRow {
  pool: string
  ts: number
  block: number
  tx_hash: string
  log_index: number
  amount0: string
  amount1: string
  base_is_token0: number
  symbol: string
  decimals: number
  baseAddr: string
}

export interface TokenPnl {
  pool: string
  token: string
  symbol: string
  decimals: number
  buys: number
  sells: number
  ethIn: number
  ethOut: number
  /** ETH banked on sells minus the pro-rata cost of what was sold. */
  realized: number
  openQtyRaw: string
  openQty: number
  openCost: number
  /** ETH per token paid on average for the open bag. */
  avgEntry: number | null
  lastClose: number | null
  markEth: number
  /** Full-size exit through the best route right now (null when unquoted). */
  realizableEth: number | null
  unrealized: number | null
  firstTs: number
  lastTs: number
  /** Sold more than we saw bought — earlier buys predate the ledger window. */
  untracked: boolean
}

export interface WalletSummary {
  address: string
  /** Stablecoin / WETH legs, reported but excluded from P&L. */
  stables: TokenPnl[]
  trades: number
  buys: number
  sells: number
  volEth: number
  ethIn: number
  ethOut: number
  netFlow: number
  realized: number
  unrealized: number | null
  realizableOpen: number
  openCost: number
  markOpen: number
  winRate: number | null
  closedTokens: number
  firstTs: number | null
  lastTs: number | null
  rank: number | null
  tokens: TokenPnl[]
}

const ETH = (r: SwapRow) => Number(r.base_is_token0 === 1 ? r.amount1 : r.amount0) / 1e18
const BASE = (r: SwapRow) => Number(r.base_is_token0 === 1 ? r.amount0 : r.amount1)

function attributedSwaps(address: string): SwapRow[] {
  return db
    .prepare(
      `SELECT s.pool, s.ts, s.block, s.tx_hash, s.log_index, s.amount0, s.amount1, p.base_is_token0,
              tb.symbol AS symbol, tb.decimals AS decimals, tb.address AS baseAddr
       FROM swaps s
       JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader = ? AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1 AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
       ORDER BY s.block ASC, s.log_index ASC`,
    )
    .all(address.toLowerCase()) as SwapRow[]
}

const cache = new Map<string, { at: number; v: WalletSummary }>()

export async function walletSummary(address: string, opts: { valueOpen?: boolean } = {}): Promise<WalletSummary> {
  const key = `${address.toLowerCase()}:${opts.valueOpen ? 1 : 0}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return hit.v

  const rows = attributedSwaps(address)
  const byToken = new Map<string, TokenPnl & { qtyRaw: number }>()
  for (const r of rows) {
    const eth = ETH(r)
    const base = BASE(r)
    let t = byToken.get(r.baseAddr)
    if (!t) {
      t = {
        pool: r.pool,
        token: r.baseAddr,
        symbol: r.symbol,
        decimals: r.decimals,
        buys: 0,
        sells: 0,
        ethIn: 0,
        ethOut: 0,
        realized: 0,
        openQtyRaw: '0',
        openQty: 0,
        openCost: 0,
        avgEntry: null,
        lastClose: null,
        markEth: 0,
        realizableEth: null,
        unrealized: null,
        firstTs: r.ts,
        lastTs: r.ts,
        untracked: false,
        qtyRaw: 0,
      }
      byToken.set(r.baseAddr, t)
    }
    t.lastTs = Math.max(t.lastTs, r.ts)
    t.firstTs = Math.min(t.firstTs, r.ts)
    if (eth > 0) {
      // Buy: ETH in, base out of the pool (negative amount) into the wallet.
      t.buys++
      t.ethIn += eth
      t.qtyRaw += -base
      t.openCost += eth
    } else if (eth < 0) {
      t.sells++
      const out = -eth
      t.ethOut += out
      const sold = base
      if (t.qtyRaw <= 0) {
        // Nothing tracked to sell: the buy predates the window; no cost known.
        t.realized += out
        t.untracked = true
      } else {
        const portion = Math.min(1, sold / t.qtyRaw)
        const costOut = t.openCost * portion
        t.realized += out - costOut
        t.openCost -= costOut
        t.qtyRaw -= sold
        if (sold > t.qtyRaw + sold) t.untracked = true
        if (t.qtyRaw < 0) t.qtyRaw = 0
      }
    }
  }

  const tokens: TokenPnl[] = []
  const closeStmt = db.prepare(`SELECT close, minute_ts FROM candles WHERE pool = ? ORDER BY minute_ts DESC LIMIT 1`)
  const now = Math.floor(Date.now() / 1000)
  for (const t of byToken.values()) {
    const { qtyRaw, ...rest } = t
    const openQty = qtyRaw / 10 ** t.decimals
    const c = closeStmt.get(t.pool) as { close: number; minute_ts: number } | undefined
    // A mark is only a mark if the candle is recent and the number is sane;
    // a dead pool's last print can imply absurd values for a big bag.
    const close = c && now - c.minute_ts < 7 * 86_400 && c.close > 0 ? c.close : null
    const mark = close && openQty > 0 ? openQty * close : 0
    tokens.push({
      ...rest,
      openQtyRaw: BigInt(Math.floor(Math.max(0, qtyRaw))).toString(),
      openQty,
      avgEntry: openQty > 0 && t.openCost > 0 ? t.openCost / openQty : null,
      lastClose: close,
      markEth: Number.isFinite(mark) && mark < 1e6 ? mark : 0,
    })
  }

  // Value the open bags at what the pool would pay (best route, full size), biggest first.
  if (opts.valueOpen) {
    const open = tokens.filter((t) => t.openQty > 0 && BigInt(t.openQtyRaw) > 0n).sort((a, b) => b.markEth - a.markEth).slice(0, 8)
    await Promise.all(
      open.map(async (t) => {
        try {
          const r = await bestFill(t.token, 'sell', BigInt(t.openQtyRaw), { skipExit: true })
          if (r.fillRatio >= 0.999) {
            t.realizableEth = Number(r.amountOut) / 1e18
            t.unrealized = t.realizableEth - t.openCost
          }
        } catch {
          // unquotable right now
        }
      }),
    )
  }
  tokens.sort((a, b) => b.realized + (b.unrealized ?? 0) - (a.realized + (a.unrealized ?? 0)))

  // Stables and wrapped ETH are cash legs, not bets: keep them out of P&L and win rate.
  const STABLE = new Set(['USDG', 'USDE', 'WETH', 'USDC', 'USDT'])
  const stables = tokens.filter((t) => STABLE.has(t.symbol.toUpperCase()))
  const bets = tokens.filter((t) => !STABLE.has(t.symbol.toUpperCase()))
  const closed = bets.filter((t) => t.sells > 0)
  const wins = closed.filter((t) => t.realized > 0).length
  const rank = (db.prepare(`SELECT rank FROM wire_rank WHERE trader = ?`).get(address.toLowerCase()) as { rank: number } | undefined)?.rank ?? null
  const valued = bets.filter((t) => t.unrealized !== null)
  const v: WalletSummary = {
    address: address.toLowerCase(),
    stables,
    trades: rows.length,
    buys: tokens.reduce((a, t) => a + t.buys, 0),
    sells: tokens.reduce((a, t) => a + t.sells, 0),
    volEth: tokens.reduce((a, t) => a + t.ethIn + t.ethOut, 0),
    ethIn: tokens.reduce((a, t) => a + t.ethIn, 0),
    ethOut: tokens.reduce((a, t) => a + t.ethOut, 0),
    netFlow: tokens.reduce((a, t) => a + t.ethOut - t.ethIn, 0),
    realized: bets.reduce((a, t) => a + t.realized, 0),
    unrealized: valued.length ? valued.reduce((a, t) => a + (t.unrealized ?? 0), 0) : null,
    realizableOpen: valued.reduce((a, t) => a + (t.realizableEth ?? 0), 0),
    openCost: bets.reduce((a, t) => a + t.openCost, 0),
    markOpen: bets.reduce((a, t) => a + t.markEth, 0),
    winRate: closed.length ? wins / closed.length : null,
    closedTokens: closed.length,
    firstTs: rows.length ? rows[0]!.ts : null,
    lastTs: rows.length ? rows[rows.length - 1]!.ts : null,
    rank,
    tokens: bets,
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

export function walletSwapLines(address: string, page = 1, size = 60): { lines: SwapLine[]; total: number } {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM swaps WHERE trader = ?`).get(address.toLowerCase()) as { n: number }).n
  const rows = db
    .prepare(
      `SELECT s.pool, s.ts, s.block, s.tx_hash, s.log_index, s.amount0, s.amount1, p.base_is_token0,
              tb.symbol AS symbol, tb.decimals AS decimals, tb.address AS baseAddr
       FROM swaps s
       JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader = ? AND p.base_is_token0 IS NOT NULL AND COALESCE(p.quote_symbol,'WETH') IN ('WETH','ETH')
       ORDER BY s.block DESC, s.log_index DESC LIMIT ? OFFSET ?`,
    )
    .all(address.toLowerCase(), size, (page - 1) * size) as SwapRow[]
  return {
    total,
    lines: rows.map((r) => {
      const eth = ETH(r)
      const qty = Math.abs(BASE(r)) / 10 ** r.decimals
      return { ts: r.ts, tx: r.tx_hash, pool: r.pool, symbol: r.symbol, side: eth > 0 ? 'buy' : 'sell', qty, eth: Math.abs(eth), price: qty > 0 ? Math.abs(eth) / qty : null }
    }),
  }
}
