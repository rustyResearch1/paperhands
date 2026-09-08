import { SCREENER_META_KEY, SCREENER_TS_KEY, screenerSnapshot } from '@paperhands/indexer'
import { db } from './db'
import { ethUsdRate } from './usd'

export interface ScreenerRow {
  address: string
  fee: number
  base_is_token0: number
  factory_verified: number
  last_sqrt_price: string | null
  last_liquidity: string | null
  swap_count: number
  baseSymbol: string
  baseName: string
  baseDecimals: number
  baseAddr: string
  lastClose: number | null
  close5m: number | null
  close30m: number | null
  vol24: number
  trades24: number
  /** Volume in the last 30 minutes vs the 30 minutes before — traction. */
  vol30: number
  vol30prev: number
  /** 'WETH' | 'ETH' (native) | 'USDG' — the currency candles are priced in. */
  quote_symbol: string
  quoteDecimals: number
}

export type ScreenerSort = 'vol' | 'traction' | 'change5m' | 'change30m' | 'trades' | 'depth'

let rowCache: { rows: ScreenerRow[]; at: number } | null = null
/** How old the indexer's stored snapshot may be before we compute live. */
const SNAPSHOT_FRESH_S = 150

/**
 * Screener rows come from the snapshot the watch loop stores every minute;
 * the live query is only the fallback for a fresh database or a stalled
 * indexer. Either way the result is cached briefly per process.
 */
export function screenerRows(limit = 100, sort: ScreenerSort = 'vol', minDepthEth = 0): GroupedRow[] {
  if (rowCache && Date.now() - rowCache.at < 5000) {
    return sortAndTrim(rowCache.rows, limit, sort, minDepthEth)
  }
  const rows = storedSnapshot() ?? (screenerSnapshot(db) as ScreenerRow[])
  rowCache = { rows, at: Date.now() }
  return sortAndTrim(rows, limit, sort, minDepthEth)
}

function storedSnapshot(): ScreenerRow[] | null {
  try {
    const ts = Number((db.prepare(`SELECT value FROM meta WHERE key = ?`).get(SCREENER_TS_KEY) as { value: string } | undefined)?.value ?? 0)
    if (!ts || Math.floor(Date.now() / 1000) - ts > SNAPSHOT_FRESH_S) return null
    const json = (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(SCREENER_META_KEY) as { value: string } | undefined)?.value
    return json ? (JSON.parse(json) as ScreenerRow[]) : null
  } catch {
    return null
  }
}

function sortAndTrim(rows: ScreenerRow[], limit: number, sort: ScreenerSort, minDepthEth: number): GroupedRow[] {
  const filtered = minDepthEth > 0 ? rows.filter((r) => ethDepth(r) >= minDepthEth) : rows
  const grouped = groupByToken(filtered)
  const key: Record<ScreenerSort, (r: GroupedRow) => number> = {
    vol: (r) => r.volEthEq,
    traction: (r) => tractionScore(r),
    change5m: (r) => pctChange(r.lastClose, r.close5m) ?? -Infinity,
    change30m: (r) => pctChange(r.lastClose, r.close30m) ?? -Infinity,
    trades: (r) => r.trades24,
    depth: (r) => ethDepth(r),
  }
  return [...grouped].sort((a, b) => key[sort](b) - key[sort](a)).slice(0, limit)
}

export interface GroupedRow extends ScreenerRow {
  poolCount: number
  /** Total 24h volume across the token's pools, in ETH-equivalent terms. */
  volEthEq: number
}

/**
 * One row per token: a JUGGERNAUT with three fee tiers is one market, not
 * three. The deepest pool is the face (price, link, quote); volumes and
 * trade counts sum across pools in ETH-equivalent terms, then re-express in
 * the face pool's quote so display conversion stays uniform.
 */
function groupByToken(rows: ScreenerRow[]): GroupedRow[] {
  const rate = ethUsdRate()
  const toEthEq = (v: number, quote: string) => (quote === 'USDG' ? (rate ? v / rate : 0) : v)
  const groups = new Map<string, ScreenerRow[]>()
  for (const r of rows) {
    const list = groups.get(r.baseAddr)
    if (list) list.push(r)
    else groups.set(r.baseAddr, [r])
  }
  const out: GroupedRow[] = []
  for (const list of groups.values()) {
    const face = list.reduce((a, b) => (ethDepth(b) > ethDepth(a) ? b : a))
    const volEthEq = list.reduce((s, r) => s + toEthEq(r.vol24, r.quote_symbol), 0)
    const vol30Eq = list.reduce((s, r) => s + toEthEq(r.vol30, r.quote_symbol), 0)
    const vol30prevEq = list.reduce((s, r) => s + toEthEq(r.vol30prev, r.quote_symbol), 0)
    const backToFace = (ethEq: number) => (face.quote_symbol === 'USDG' ? ethEq * (rate ?? 0) : ethEq)
    out.push({
      ...face,
      poolCount: list.length,
      volEthEq,
      vol24: backToFace(volEthEq),
      vol30: backToFace(vol30Eq),
      vol30prev: backToFace(vol30prevEq),
      trades24: list.reduce((s, r) => s + r.trades24, 0),
    })
  }
  return out
}

/**
 * Traction = volume acceleration, damped by absolute size so a 0.01→0.1 ETH
 * blip doesn't outrank a 20→60 ETH surge: log-volume times the accel ratio.
 */
export function tractionScore(r: Pick<ScreenerRow, 'vol30' | 'vol30prev'>): number {
  if (r.vol30 <= 0) return -Infinity
  const accel = r.vol30 / Math.max(r.vol30prev, 0.05)
  return Math.log10(1 + r.vol30) * Math.min(accel, 50)
}

/** Virtual in-range quote-side depth of a pool, in human quote units. */
export function quoteDepth(
  row: Pick<ScreenerRow, 'last_sqrt_price' | 'last_liquidity' | 'base_is_token0'> & { quoteDecimals?: number },
): number {
  if (!row.last_sqrt_price || !row.last_liquidity) return 0
  const sqrtP = Number(row.last_sqrt_price) / 2 ** 96
  const L = Number(row.last_liquidity)
  const reserve = row.base_is_token0 === 1 ? L * sqrtP : sqrtP > 0 ? L / sqrtP : 0
  return reserve / 10 ** (row.quoteDecimals ?? 18)
}

/** Depth normalized to ETH terms, so filters and sorts compare across quotes. */
export function ethDepth(row: ScreenerRow): number {
  const d = quoteDepth(row)
  if (row.quote_symbol !== 'USDG') return d
  const rate = ethUsdRate()
  return rate ? d / rate : 0
}

export function pctChange(now: number | null, then: number | null): number | null {
  if (!now || !then || then === 0) return null
  return ((now - then) / then) * 100
}
