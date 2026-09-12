import { PONS, curveAmountOut, ponsCurveAbi, snipeTaxBpsAt } from '@paperhands/indexer'
import type { Address } from 'viem'
import { chainClient } from './chain'
import { db } from './db'
import { swr } from './swr'
import { ethUsdRate } from './usd'

/**
 * PONS launches for the web: feeds, one launch in depth, and a live quote on
 * its bonding curve computed with the curve's own maths (ported, not
 * approximated) from state read at one block — the same standard as the swap
 * engine. Everything in the feeds is a cheap indexed query; only the detail
 * page's live state touches the RPC, and it is cached briefly.
 */
export interface LaunchRow {
  token: string
  symbol: string
  name: string
  decimals: number
  curve: string
  deployer: string
  pairToken: string
  nativeQuote: boolean
  /** The token the curve is quoted in: ETH, USDG, or a tokenized stock (NVDA, GOOGL, TSLA…). */
  quoteSymbol: string
  quoteDecimals: number
  /** Dollars per unit of the quote token, from our own ledger; null when unpriced. */
  quoteUsd: number | null
  /** Graduation threshold in quote units. */
  threshold: number
  launchBlock: number
  launchTs: number
  ageSec: number
  buys: number
  sells: number
  traders: number
  /** Quote put in / taken out, in quote units — and in dollars when the quote is priced. */
  quoteIn: number
  quoteOut: number
  inUsd: number | null
  outUsd: number | null
  /** Net quote sitting in the curve after fees and taxes, quote units. */
  reserve: number
  progressPct: number | null
  /** Quote units per launch token, last trade. */
  lastPrice: number | null
  /** Implied market cap of the full launch supply at the last price, quote units and dollars. */
  mcapQuote: number | null
  mcapUsd: number | null
  trades5m: number
  buys5m: number
  graduatedTs: number | null
  pool: string | null
  status: 'live' | 'graduating' | 'graduated'
  /** Deployer's record across all launches we have seen. */
  deployerLaunches: number
  deployerGraduated: number
}

const LAUNCH_SUPPLY = 1_000_000_000

const SELECT = `
  SELECT l.token, t.symbol, t.name, t.decimals, l.curve, l.deployer, l.pair_token, l.graduation_threshold, l.launch_block, l.launch_ts,
         l.buys, l.sells, l.traders, l.quote_in, l.quote_out, l.fees, l.taxes, l.last_price, l.graduated_ts, l.pool,
         COALESCE(q.symbol, 'ETH') AS quote_symbol, COALESCE(q.decimals, 18) AS quote_decimals,
         (SELECT COUNT(*) FROM launches d WHERE d.deployer = l.deployer) AS deployer_launches,
         (SELECT COUNT(*) FROM launches d WHERE d.deployer = l.deployer AND d.graduated_block IS NOT NULL) AS deployer_graduated
  FROM launches l JOIN tokens t ON t.address = l.token LEFT JOIN tokens q ON q.address = l.pair_token`

interface Raw {
  token: string
  symbol: string
  name: string
  decimals: number
  curve: string
  deployer: string
  pair_token: string
  graduation_threshold: string
  launch_block: number
  launch_ts: number
  buys: number
  sells: number
  traders: number
  quote_in: number
  quote_out: number
  fees: number
  taxes: number
  last_price: number | null
  graduated_ts: number | null
  pool: string | null
  quote_symbol: string
  quote_decimals: number
  deployer_launches: number
  deployer_graduated: number
}

/**
 * Dollars per unit of a quote token, from our own ledger: ETH from the USDG
 * face pool, USDG is the dollar, and a tokenized stock from its deepest
 * priced Uniswap pool. Cached a minute per token.
 */
const usdCache = new Map<string, { at: number; v: number | null }>()
export function quoteTokenUsd(pairToken: string): number | null {
  const key = pairToken.toLowerCase()
  const hit = usdCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.v
  const eth = ethUsdRate()
  let v: number | null = null
  if (key === PONS.native) v = eth
  else {
    const row = db
      .prepare(
        `SELECT (SELECT close FROM candles c WHERE c.pool = p.address ORDER BY minute_ts DESC LIMIT 1) AS close, COALESCE(p.quote_symbol,'WETH') AS q, tb.symbol AS sym
         FROM pools p JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
         WHERE tb.address = ? AND p.factory_verified = 1 AND p.base_is_token0 IS NOT NULL
         ORDER BY p.swap_count DESC LIMIT 1`,
      )
      .get(key) as { close: number | null; q: string; sym: string } | undefined
    if (row?.sym === 'USDG') v = 1
    else if (row?.close) v = row.q === 'USDG' ? row.close : eth ? row.close * eth : null
  }
  usdCache.set(key, { at: Date.now(), v })
  return v
}

function shape(r: Raw, recent: Map<string, { n: number; buys: number }>): LaunchRow {
  const now = Math.floor(Date.now() / 1000)
  const nativeQuote = r.pair_token === PONS.native
  const qd = 10 ** r.quote_decimals
  const threshold = Number(BigInt(r.graduation_threshold)) / qd
  const quoteIn = r.quote_in / qd
  const quoteOut = r.quote_out / qd
  const reserve = (r.quote_in - r.fees - r.taxes - r.quote_out) / qd
  const progress = threshold > 0 ? Math.max(0, Math.min(100, (reserve / threshold) * 100)) : null
  const quoteUsd = quoteTokenUsd(r.pair_token)
  const rec = recent.get(r.token)
  const status: LaunchRow['status'] = r.graduated_ts ? 'graduated' : progress !== null && progress >= 80 ? 'graduating' : 'live'
  const mcapQuote = r.last_price ? r.last_price * LAUNCH_SUPPLY : null
  return {
    token: r.token,
    symbol: r.symbol,
    name: r.name,
    decimals: r.decimals,
    curve: r.curve,
    deployer: r.deployer,
    pairToken: r.pair_token,
    nativeQuote,
    quoteSymbol: nativeQuote ? 'ETH' : r.quote_symbol,
    quoteDecimals: r.quote_decimals,
    quoteUsd,
    threshold,
    launchBlock: r.launch_block,
    launchTs: r.launch_ts,
    ageSec: Math.max(0, now - r.launch_ts),
    buys: r.buys,
    sells: r.sells,
    traders: r.traders,
    quoteIn,
    quoteOut,
    inUsd: quoteUsd !== null ? quoteIn * quoteUsd : null,
    outUsd: quoteUsd !== null ? quoteOut * quoteUsd : null,
    reserve,
    progressPct: progress,
    lastPrice: r.last_price,
    mcapQuote,
    mcapUsd: mcapQuote !== null && quoteUsd !== null ? mcapQuote * quoteUsd : null,
    trades5m: rec?.n ?? 0,
    buys5m: rec?.buys ?? 0,
    graduatedTs: r.graduated_ts,
    pool: r.pool,
    status,
    deployerLaunches: r.deployer_launches,
    deployerGraduated: r.deployer_graduated,
  }
}

function curveTip(): number {
  return Number((db.prepare(`SELECT MAX(block) AS b FROM curve_trades`).get() as { b: number | null }).b ?? 0)
}

/** Trades per token over the last ~5 minutes of blocks (10 blk/s). */
function recentActivity(blocks = 3000): Map<string, { n: number; buys: number }> {
  const tip = curveTip()
  const rows = db
    .prepare(`SELECT token, COUNT(*) AS n, SUM(side = 'buy') AS buys FROM curve_trades WHERE block > ? GROUP BY token`)
    .all(tip - blocks) as { token: string; n: number; buys: number }[]
  return new Map(rows.map((r) => [r.token, { n: r.n, buys: r.buys }]))
}

export type LaunchFeed = 'new' | 'trending' | 'graduating' | 'graduated'

export function launchFeed(kind: LaunchFeed, limit = 40): LaunchRow[] {
  const recent = recentActivity()
  let rows: Raw[]
  if (kind === 'trending') {
    const top = [...recent.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, limit)
    if (top.length === 0) return []
    const ph = top.map(() => '?').join(',')
    rows = db.prepare(`${SELECT} WHERE l.token IN (${ph}) AND l.graduated_block IS NULL`).all(...top.map((t) => t[0])) as Raw[]
    const order = new Map(top.map((t, i) => [t[0], i]))
    rows.sort((a, b) => (order.get(a.token) ?? 0) - (order.get(b.token) ?? 0))
  } else if (kind === 'graduated') {
    rows = db.prepare(`${SELECT} WHERE l.graduated_block IS NOT NULL ORDER BY l.graduated_block DESC LIMIT ?`).all(limit) as Raw[]
  } else if (kind === 'graduating') {
    // Fullest curves first, in each launch's own quote units (the ratio is unit-free).
    rows = db
      .prepare(`${SELECT} WHERE l.graduated_block IS NULL AND l.buys > 0 AND CAST(l.graduation_threshold AS REAL) > 0 ORDER BY (l.quote_in - l.fees - l.taxes - l.quote_out) / CAST(l.graduation_threshold AS REAL) DESC LIMIT ?`)
      .all(limit) as Raw[]
  } else {
    rows = db.prepare(`${SELECT} ORDER BY l.launch_block DESC LIMIT ?`).all(limit) as Raw[]
  }
  return rows.map((r) => shape(r, recent))
}

export interface CurveTrade {
  ts: number
  block: number
  tx: string
  side: 'buy' | 'sell'
  trader: string
  eth: number
  tokens: number
  price: number | null
  feeEth: number
  taxEth: number
}

export interface LaunchDetail {
  launch: LaunchRow
  trades: CurveTrade[]
  /** Net tokens per trader from curve trades, largest first. */
  holders: { trader: string; tokens: number; ethIn: number; ethOut: number; buys: number; sells: number }[]
  deployerLaunches: LaunchRow[]
}

export function launchDetail(token: string): LaunchDetail | null {
  const t = token.toLowerCase()
  const recent = recentActivity()
  const raw = db.prepare(`${SELECT} WHERE l.token = ?`).get(t) as Raw | undefined
  if (!raw) return null
  const launch = shape(raw, recent)
  const dec = 10 ** raw.decimals
  const qd = 10 ** raw.quote_decimals
  const trades = (
    db.prepare(`SELECT ts, block, tx_hash, side, trader, quote_raw, tokens_raw, fee_raw, tax_raw FROM curve_trades WHERE token = ? ORDER BY block DESC, log_index DESC LIMIT 80`).all(t) as {
      ts: number
      block: number
      tx_hash: string
      side: 'buy' | 'sell'
      trader: string
      quote_raw: string
      tokens_raw: string
      fee_raw: string
      tax_raw: string
    }[]
  ).map((r) => {
    const eth = Number(r.quote_raw) / qd
    const tokens = Number(r.tokens_raw) / dec
    return { ts: r.ts, block: r.block, tx: r.tx_hash, side: r.side, trader: r.trader, eth, tokens, price: tokens > 0 ? eth / tokens : null, feeEth: Number(r.fee_raw) / qd, taxEth: Number(r.tax_raw) / qd }
  })
  const holders = (
    db
      .prepare(
        `SELECT trader, SUM(CASE WHEN side = 'buy' THEN CAST(tokens_raw AS REAL) ELSE -CAST(tokens_raw AS REAL) END) AS net,
                SUM(CASE WHEN side = 'buy' THEN CAST(quote_raw AS REAL) ELSE 0 END) AS eth_in,
                SUM(CASE WHEN side = 'sell' THEN CAST(quote_raw AS REAL) ELSE 0 END) AS eth_out,
                SUM(side = 'buy') AS buys, SUM(side = 'sell') AS sells
         FROM curve_trades WHERE token = ? GROUP BY trader HAVING net > 0 ORDER BY net DESC LIMIT 15`,
      )
      .all(t) as { trader: string; net: number; eth_in: number; eth_out: number; buys: number; sells: number }[]
  ).map((h) => ({ trader: h.trader, tokens: h.net / dec, ethIn: h.eth_in / qd, ethOut: h.eth_out / qd, buys: h.buys, sells: h.sells }))
  const deployerLaunches = (db.prepare(`${SELECT} WHERE l.deployer = ? AND l.token != ? ORDER BY l.launch_block DESC LIMIT 12`).all(raw.deployer, t) as Raw[]).map((r) => shape(r, recent))
  return { launch, trades, holders, deployerLaunches }
}

// ---------------------------------------------------------------------------
// Live curve state and an exact quote on it.

export interface CurveState {
  block: number
  quoteReserve: bigint
  tokenReserve: bigint
  realQuoteReserve: bigint
  feeBps: bigint
  creatorTaxBps: bigint
  snipeTaxStartBps: bigint
  snipeTaxSeconds: number
  launchedAt: number
  graduated: boolean
  sellableTokens: bigint
}

/** The curve's immutables (fee, tax, snipe window, launch time): read once per process. */
function curveImmutables(curve: string) {
  return swr(`curve:imm:${curve.toLowerCase()}`, 6 * 3600_000, async () => {
    const c = { address: curve as Address, abi: ponsCurveAbi } as const
    const [feeBps, taxBps, snipeStart, snipeSec, launchedAt] = await Promise.all([
      chainClient.readContract({ ...c, functionName: 'feeBps' }),
      chainClient.readContract({ ...c, functionName: 'creatorTaxBps' }),
      chainClient.readContract({ ...c, functionName: 'snipeTaxStartBps' }),
      chainClient.readContract({ ...c, functionName: 'snipeTaxSeconds' }),
      chainClient.readContract({ ...c, functionName: 'launchedAt' }),
    ])
    return { feeBps, creatorTaxBps: taxBps, snipeTaxStartBps: snipeStart, snipeTaxSeconds: Number(snipeSec), launchedAt: Number(launchedAt) }
  })
}

/**
 * Live curve state: the immutables from cache plus four reads pinned to one
 * block. Kept small on purpose — on the public RPC every read counts against a
 * per-minute limiter, and a quote box refreshes every fifteen seconds.
 */
export function curveState(curve: string): Promise<CurveState> {
  return swr(`curve:${curve.toLowerCase()}`, 15_000, async () => {
    const c = { address: curve as Address, abi: ponsCurveAbi } as const
    const imm = await curveImmutables(curve)
    const block = await chainClient.getBlockNumber()
    const at = { blockNumber: block }
    const [reserves, real, graduated, sellable] = await Promise.all([
      chainClient.readContract({ ...c, functionName: 'getReserves', ...at }),
      chainClient.readContract({ ...c, functionName: 'realQuoteReserve', ...at }),
      chainClient.readContract({ ...c, functionName: 'graduated', ...at }),
      chainClient.readContract({ ...c, functionName: 'sellableTokens', ...at }),
    ])
    return { block: Number(block), quoteReserve: reserves[0], tokenReserve: reserves[1], realQuoteReserve: real, ...imm, graduated, sellableTokens: sellable }
  })
}

export interface CurveQuote {
  side: 'buy' | 'sell'
  amountIn: bigint
  amountOut: bigint
  fee: bigint
  tax: bigint
  snipeTax: bigint
  snipeTaxBps: number
  /** Price paid per token vs the curve's spot before the trade, in bps. */
  priceImpactBps: number
  spotPrice: number
  execPrice: number
}

/**
 * The curve's `buy`: fee and creator tax come off the input, then the snipe
 * tax (capped so the buyer always nets something), then constant product on
 * the phantom reserve. `sell` is the mirror: constant product first, then fee
 * and tax off the quote out. Ported from the verified source.
 */
export function quoteCurve(state: CurveState, side: 'buy' | 'sell', amountIn: bigint, decimals: number, quoteDecimals = 18, nowSec = Math.floor(Date.now() / 1000)): CurveQuote {
  const BPS = 10_000n
  const qd = 10 ** quoteDecimals
  const spot = Number(state.quoteReserve) / qd / (Number(state.tokenReserve) / 10 ** decimals)
  if (side === 'buy') {
    let snipeBps = snipeTaxBpsAt(state.snipeTaxStartBps, state.launchedAt, state.snipeTaxSeconds, nowSec)
    if (snipeBps !== 0n) {
      const maxSnipe = BPS - state.feeBps - state.creatorTaxBps - 100n
      if (snipeBps > maxSnipe) snipeBps = maxSnipe
    }
    const fee = (amountIn * state.feeBps) / BPS
    const tax = (amountIn * state.creatorTaxBps) / BPS
    const snipeTax = (amountIn * snipeBps) / BPS
    const net = amountIn - fee - tax - snipeTax
    const out = curveAmountOut(net, state.quoteReserve, state.tokenReserve, 0n)
    const exec = out > 0n ? Number(amountIn) / qd / (Number(out) / 10 ** decimals) : 0
    return { side, amountIn, amountOut: out, fee, tax, snipeTax, snipeTaxBps: Number(snipeBps), priceImpactBps: spot > 0 && exec > 0 ? Math.max(0, (exec / spot - 1) * 10_000) : 0, spotPrice: spot, execPrice: exec }
  }
  const gross = curveAmountOut(amountIn, state.tokenReserve, state.quoteReserve, 0n)
  const fee = (gross * state.feeBps) / BPS
  const tax = (gross * state.creatorTaxBps) / BPS
  const out = gross - fee - tax
  const exec = amountIn > 0n ? Number(out) / qd / (Number(amountIn) / 10 ** decimals) : 0
  return { side, amountIn, amountOut: out, fee, tax, snipeTax: 0n, snipeTaxBps: 0, priceImpactBps: spot > 0 && exec > 0 ? Math.max(0, (1 - exec / spot) * 10_000) : 0, spotPrice: spot, execPrice: exec }
}

export function launchUsd(eth: number): number | null {
  const r = ethUsdRate()
  return r ? eth * r : null
}

/** Hub totals: launches, graduations, trades, wallets, and dollars put into curves (priced quotes only). */
export function launchTotals(): { launches: number; graduated: number; trades: number; traders: number; inUsd: number; pricedShare: number; quotes: { symbol: string; launches: number }[] } {
  const base = db
    .prepare(
      `SELECT COUNT(*) AS launches, SUM(graduated_block IS NOT NULL) AS graduated,
              (SELECT COUNT(*) FROM curve_trades) AS trades, (SELECT COUNT(DISTINCT trader) FROM curve_trades) AS traders
       FROM launches`,
    )
    .get() as { launches: number; graduated: number; trades: number; traders: number }
  const byQuote = db
    .prepare(`SELECT l.pair_token, COALESCE(q.symbol,'ETH') AS symbol, COALESCE(q.decimals,18) AS decimals, COUNT(*) AS n, SUM(l.quote_in) AS raw_in FROM launches l LEFT JOIN tokens q ON q.address = l.pair_token GROUP BY l.pair_token ORDER BY n DESC`)
    .all() as { pair_token: string; symbol: string; decimals: number; n: number; raw_in: number }[]
  let inUsd = 0
  let priced = 0
  for (const r of byQuote) {
    const usd = quoteTokenUsd(r.pair_token)
    if (usd !== null) {
      inUsd += (r.raw_in / 10 ** r.decimals) * usd
      priced += r.n
    }
  }
  return { ...base, inUsd, pricedShare: base.launches ? priced / base.launches : 0, quotes: byQuote.slice(0, 8).map((r) => ({ symbol: r.pair_token === PONS.native ? 'ETH' : r.symbol, launches: r.n })) }
}
