import type { XChain } from './types'

/**
 * GeckoTerminal — keyless market data for every chain we don't index
 * ourselves: trending pools, token facts, minute candles, recent trades.
 * ~30 requests/min, so everything here is cached.
 */
const GT = 'https://api.geckoterminal.com/api/v2'
export const GT_NETWORK: Record<XChain, string> = { rh: 'robinhood', sol: 'solana', bsc: 'bsc' }

const cache = new Map<string, { at: number; v: unknown }>()
async function gt<T>(path: string, ttlMs: number): Promise<T> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T
  const res = await fetch(`${GT}${path}`, { headers: { accept: 'application/json;version=20230302' }, cache: 'no-store' })
  if (!res.ok) throw new Error(`geckoterminal ${res.status}`)
  const v = (await res.json()) as T
  cache.set(path, { at: Date.now(), v })
  return v
}

export interface GtPool {
  address: string
  name: string
  dex: string
  baseToken: string
  quoteToken: string
  priceUsd: number | null
  reserveUsd: number
  volume: { m5: number; h1: number; h6: number; h24: number }
  change: { m5: number; h1: number; h6: number; h24: number }
  txns24: { buys: number; sells: number }
  createdAt: string | null
}

interface GtPoolRaw {
  id: string
  attributes: {
    address: string
    name: string
    base_token_price_usd: string | null
    reserve_in_usd: string
    pool_created_at: string | null
    volume_usd: Record<string, string>
    price_change_percentage: Record<string, string>
    transactions: Record<string, { buys: number; sells: number }>
  }
  relationships: { dex: { data: { id: string } }; base_token: { data: { id: string } }; quote_token: { data: { id: string } } }
}

const num = (s: string | null | undefined) => (s === null || s === undefined ? 0 : Number(s))
const tokenId = (id: string) => id.split('_').slice(1).join('_')

function mapPool(p: GtPoolRaw): GtPool {
  const a = p.attributes
  return {
    address: a.address,
    name: a.name,
    dex: p.relationships.dex.data.id,
    baseToken: tokenId(p.relationships.base_token.data.id),
    quoteToken: tokenId(p.relationships.quote_token.data.id),
    priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
    reserveUsd: num(a.reserve_in_usd),
    volume: { m5: num(a.volume_usd.m5), h1: num(a.volume_usd.h1), h6: num(a.volume_usd.h6), h24: num(a.volume_usd.h24) },
    change: { m5: num(a.price_change_percentage.m5), h1: num(a.price_change_percentage.h1), h6: num(a.price_change_percentage.h6), h24: num(a.price_change_percentage.h24) },
    txns24: a.transactions.h24 ?? { buys: 0, sells: 0 },
    createdAt: a.pool_created_at,
  }
}

export async function trendingPools(chain: XChain, pages = 1): Promise<GtPool[]> {
  const out: GtPool[] = []
  for (let page = 1; page <= pages; page++) {
    const r = await gt<{ data: GtPoolRaw[] }>(`/networks/${GT_NETWORK[chain]}/trending_pools?page=${page}`, 60_000)
    out.push(...r.data.map(mapPool))
  }
  return out
}

export async function topPools(chain: XChain, page = 1): Promise<GtPool[]> {
  const r = await gt<{ data: GtPoolRaw[] }>(`/networks/${GT_NETWORK[chain]}/pools?page=${page}&sort=h24_volume_usd_desc`, 60_000)
  return r.data.map(mapPool)
}

export async function tokenPools(chain: XChain, token: string): Promise<GtPool[]> {
  const r = await gt<{ data: GtPoolRaw[] }>(`/networks/${GT_NETWORK[chain]}/tokens/${token}/pools?page=1`, 60_000)
  return r.data.map(mapPool)
}

export interface GtToken {
  address: string
  name: string
  symbol: string
  decimals: number
  priceUsd: number | null
  volume24: number
  reserveUsd: number
  fdvUsd: number | null
}

export async function tokenInfo(chain: XChain, token: string): Promise<GtToken> {
  const r = await gt<{ data: { attributes: { address: string; name: string; symbol: string; decimals: number; price_usd: string | null; volume_usd: { h24: string }; total_reserve_in_usd: string; fdv_usd: string | null } } }>(
    `/networks/${GT_NETWORK[chain]}/tokens/${token}`,
    120_000,
  )
  const a = r.data.attributes
  return { address: a.address, name: a.name, symbol: a.symbol, decimals: a.decimals, priceUsd: a.price_usd ? Number(a.price_usd) : null, volume24: num(a.volume_usd?.h24), reserveUsd: num(a.total_reserve_in_usd), fdvUsd: a.fdv_usd ? Number(a.fdv_usd) : null }
}

export interface Candle {
  ts: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Minute candles (USD), oldest first. `limit` ≤ 1000. */
export async function poolCandles(chain: XChain, pool: string, timeframe: 'minute' | 'hour' | 'day' = 'minute', aggregate = 1, limit = 300): Promise<Candle[]> {
  const r = await gt<{ data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } }>(
    `/networks/${GT_NETWORK[chain]}/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`,
    30_000,
  )
  return r.data.attributes.ohlcv_list
    .map(([ts, open, high, low, close, volume]) => ({ ts, open, high, low, close, volume }))
    .sort((a, b) => a.ts - b.ts)
}

export async function simplePriceUsd(chain: XChain, addresses: string[]): Promise<Record<string, number>> {
  if (addresses.length === 0) return {}
  const r = await gt<{ data: { attributes: { token_prices: Record<string, string> } } }>(
    `/simple/networks/${GT_NETWORK[chain]}/token_price/${addresses.slice(0, 30).join(',')}`,
    30_000,
  )
  return Object.fromEntries(Object.entries(r.data.attributes.token_prices).map(([k, v]) => [k.toLowerCase(), Number(v)]))
}
