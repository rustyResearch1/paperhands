import { v3PoolAbi } from '@paperhands/chain'
import type { Address } from 'viem'
import { db } from '../db'
import { suggestRanges } from '../lpstrategy'
import { ethUsdRate } from '../usd'
import { bscClient } from './bsc'
import { poolCandles, topPools } from './gecko'
import type { XChain } from './types'

/**
 * The LP screener: every concentrated-liquidity venue we can price, ranked by
 * what an LP actually earns — 24h fees over TVL — against what it costs them:
 * realized volatility (a position's range survives about one σ per day).
 *
 *   fee-to-vol = daily fee yield / daily σ
 *
 * Sources: our ledger (Robinhood Chain), Orca Whirlpools + Meteora DLMM
 * (their APIs, Solana), PancakeSwap v3 (GeckoTerminal + on-chain fee, BSC).
 * σ comes from minute candles; ranges are 1σ / 2σ / 4σ like the LP Lab.
 */
export interface LpPoolRow {
  chain: XChain
  address: string
  name: string
  dex: string
  /** LP fee in percent (e.g. 0.25). Dynamic-fee pools report the current fee. */
  feePct: number
  tvlUsd: number
  vol24Usd: number
  fees24Usd: number
  /** fees24 / tvl, as a percent per day. */
  feeYieldDayPct: number
  aprPct: number
  volTvl: number
  sigma24Pct: number | null
  /** fee-to-vol score; null when σ is unknown. */
  score: number | null
  ranges: { tight: number; balanced: number; wide: number } | null
  /** Where to act: our token page (RH / x chains) or the venue. */
  href: string
  /** Whether PaperHands can open the position itself (else we link out). */
  executable: boolean
}

const clampPct = (v: number) => Math.min(300, Math.max(3, Math.round(v)))
const rangesFromSigma = (sigmaPct: number | null) => (sigmaPct === null ? null : { tight: clampPct(sigmaPct), balanced: clampPct(sigmaPct * 2), wide: clampPct(sigmaPct * 4) })
const score = (feeYieldDayPct: number, sigmaPct: number | null) => (sigmaPct === null ? null : feeYieldDayPct / Math.max(sigmaPct, 1))

const cache = new Map<string, { at: number; rows: LpPoolRow[] }>()
const TTL = 5 * 60_000

async function cached(key: string, ttl: number, fn: () => Promise<LpPoolRow[]>): Promise<LpPoolRow[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.rows
  const rows = await fn()
  cache.set(key, { at: Date.now(), rows })
  return rows
}

// ---------------------------------------------------------------------------
// Robinhood Chain — our ledger

export async function rhLpPools(limit = 25): Promise<LpPoolRow[]> {
  return cached(`rh:${limit}`, TTL, async () => {
    const now = Math.floor(Date.now() / 1000)
    const rate = ethUsdRate() ?? 0
    const rows = db
      .prepare(
        `SELECT p.address, p.fee, p.version, p.base_is_token0, COALESCE(p.quote_symbol,'WETH') AS q,
                tb.symbol AS base, tq.decimals AS qd,
                CAST(p.last_liquidity AS REAL) AS liq, CAST(p.last_sqrt_price AS REAL) AS sqrtp,
                (SELECT COALESCE(SUM(vol_quote),0) FROM candles c WHERE c.pool=p.address AND c.minute_ts > @t24) AS vol24
         FROM pools p
         JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0=1 THEN p.token0 ELSE p.token1 END
         JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0=1 THEN p.token1 ELSE p.token0 END
         WHERE p.factory_verified = 1 AND p.base_is_token0 IS NOT NULL AND (p.hooks IS NULL OR p.hooks = '0x0000000000000000000000000000000000000000')
           AND p.fee < 8388608 AND p.swap_count > 50
         ORDER BY vol24 DESC LIMIT @n`,
      )
      .all({ t24: now - 86_400, n: limit * 2 }) as { address: string; fee: number; version: number; base_is_token0: number; q: string; base: string; qd: number; liq: number; sqrtp: number; vol24: number }[]
    const out: LpPoolRow[] = []
    for (const r of rows) {
      const usdPerQuote = r.q === 'USDG' ? 1 : rate
      if (!usdPerQuote) continue
      const sqrt = r.sqrtp / 2 ** 96
      const quoteReserve = r.sqrtp > 0 ? (r.base_is_token0 === 1 ? r.liq * sqrt : r.liq / sqrt) / 10 ** r.qd : 0
      const tvlUsd = 2 * quoteReserve * usdPerQuote // both sides of the active range
      const vol24Usd = r.vol24 * usdPerQuote
      if (tvlUsd < 500) continue
      const feePct = r.fee / 10_000
      const fees24Usd = vol24Usd * (r.fee / 1e6)
      const feeYieldDayPct = tvlUsd > 0 ? (fees24Usd / tvlUsd) * 100 : 0
      let sigma: number | null = null
      try {
        const s = suggestRanges(r.address)
        sigma = s.candles >= 60 ? s.sigma24Pct : null
      } catch {
        sigma = null
      }
      out.push({
        chain: 'rh',
        address: r.address,
        name: `${r.base}/${r.q === 'WETH' ? 'ETH' : r.q}`,
        dex: `uniswap v${r.version}`,
        feePct,
        tvlUsd,
        vol24Usd,
        fees24Usd,
        feeYieldDayPct,
        aprPct: feeYieldDayPct * 365,
        volTvl: tvlUsd > 0 ? vol24Usd / tvlUsd : 0,
        sigma24Pct: sigma,
        score: score(feeYieldDayPct, sigma),
        ranges: rangesFromSigma(sigma),
        href: `/t/${r.address}`,
        executable: r.version === 3 && (r.q === 'WETH' || r.q === 'ETH'),
      })
      if (out.length >= limit) break
    }
    return out
  })
}

// ---------------------------------------------------------------------------
// Solana — Orca Whirlpools + Meteora DLMM

interface OrcaPool {
  address: string
  tokenMintA?: string
  tokenMintB?: string
  tokenA?: { symbol?: string; address?: string }
  tokenB?: { symbol?: string; address?: string }
  tickSpacing: number
  feeRate: number
  tvlUsdc: string
  stats?: { '24h'?: { volume?: string; fees?: string; yieldOverTvl?: string } }
}

export async function orcaPools(limit = 25): Promise<LpPoolRow[]> {
  return cached(`orca:${limit}`, TTL, async () => {
    const res = await fetch(`https://api.orca.so/v2/solana/pools?sort=volume24h:desc&size=${Math.min(limit * 2, 60)}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) throw new Error(`orca ${res.status}`)
    const { data } = (await res.json()) as { data: OrcaPool[] }
    return data
      .map<LpPoolRow | null>((p) => {
        const tvlUsd = Number(p.tvlUsdc)
        const vol24Usd = Number(p.stats?.['24h']?.volume ?? 0)
        const fees24Usd = Number(p.stats?.['24h']?.fees ?? 0)
        if (!(tvlUsd > 1000)) return null
        const feeYieldDayPct = (fees24Usd / tvlUsd) * 100
        const a = p.tokenA?.symbol ?? p.tokenMintA?.slice(0, 4) ?? '?'
        const b = p.tokenB?.symbol ?? p.tokenMintB?.slice(0, 4) ?? '?'
        return {
          chain: 'sol',
          address: p.address,
          name: `${a}/${b}`,
          dex: 'orca whirlpool',
          feePct: p.feeRate / 10_000,
          tvlUsd,
          vol24Usd,
          fees24Usd,
          feeYieldDayPct,
          aprPct: feeYieldDayPct * 365,
          volTvl: vol24Usd / tvlUsd,
          sigma24Pct: null,
          score: null,
          ranges: null,
          href: `/x/sol/${[p.tokenMintA ?? p.tokenA?.address, p.tokenMintB ?? p.tokenB?.address].find((m) => m && m !== 'So11111111111111111111111111111111111111112') ?? ''}`,
          executable: [p.tokenMintA ?? p.tokenA?.address, p.tokenMintB ?? p.tokenB?.address].includes('So11111111111111111111111111111111111111112'),
        }
      })
      .filter((r): r is LpPoolRow => r !== null)
      .slice(0, limit)
  })
}

interface MeteoraPool {
  address: string
  name: string
  token_x: { address: string; symbol: string }
  token_y: { address: string; symbol: string }
  pool_config: { bin_step: number; base_fee_pct: number }
  dynamic_fee_pct?: number
  tvl: number
  volume: { '24h': number }
  fees: { '24h': number }
  apr: number
}

export async function meteoraPools(limit = 25): Promise<LpPoolRow[]> {
  return cached(`meteora:${limit}`, TTL, async () => {
    const res = await fetch(`https://dlmm.datapi.meteora.ag/pools?limit=${Math.min(limit * 2, 50)}&order_by=volume_24h&order=desc`, { headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) throw new Error(`meteora ${res.status}`)
    const { data } = (await res.json()) as { data: MeteoraPool[] }
    return data
      .map<LpPoolRow | null>((p) => {
        const tvlUsd = Number(p.tvl)
        if (!(tvlUsd > 1000)) return null
        const vol24Usd = Number(p.volume?.['24h'] ?? 0)
        const fees24Usd = Number(p.fees?.['24h'] ?? 0)
        const feeYieldDayPct = (fees24Usd / tvlUsd) * 100
        return {
          chain: 'sol',
          address: p.address,
          name: `${p.token_x.symbol}/${p.token_y.symbol}`,
          dex: `meteora dlmm · bin ${p.pool_config.bin_step}`,
          // DLMM fee = base + variable (volatility) component, both in percent.
          feePct: p.pool_config.base_fee_pct + (p.dynamic_fee_pct && p.dynamic_fee_pct > 0 ? p.dynamic_fee_pct : 0),
          tvlUsd,
          vol24Usd,
          fees24Usd,
          feeYieldDayPct,
          aprPct: feeYieldDayPct * 365,
          volTvl: vol24Usd / tvlUsd,
          sigma24Pct: null,
          score: null,
          ranges: null,
          href: `/x/sol/${p.token_x.address}`,
          executable: false,
        }
      })
      .filter((r): r is LpPoolRow => r !== null)
      .slice(0, limit)
  })
}

// ---------------------------------------------------------------------------
// BSC — PancakeSwap v3 (GeckoTerminal volume leaders + on-chain fee)

const feeCache = new Map<string, number>()
async function pancakeFee(pool: string): Promise<number | null> {
  const hit = feeCache.get(pool)
  if (hit !== undefined) return hit
  try {
    const fee = await bscClient.readContract({ address: pool as Address, abi: v3PoolAbi, functionName: 'fee' })
    feeCache.set(pool, Number(fee))
    return Number(fee)
  } catch {
    return null
  }
}

export async function pancakePools(limit = 25): Promise<LpPoolRow[]> {
  return cached(`pancake:${limit}`, TTL, async () => {
    const pages = await Promise.all([topPools('bsc', 1), topPools('bsc', 2).catch(() => [])])
    const v3 = pages.flat().filter((p) => p.dex === 'pancakeswap-v3-bsc' && p.reserveUsd > 1000)
    const out: LpPoolRow[] = []
    for (const p of v3.slice(0, limit)) {
      const fee = await pancakeFee(p.address)
      if (fee === null) continue
      const fees24Usd = p.volume.h24 * (fee / 1e6)
      const feeYieldDayPct = (fees24Usd / p.reserveUsd) * 100
      out.push({
        chain: 'bsc',
        address: p.address,
        name: p.name.replace(' / ', '/'),
        dex: 'pancakeswap v3',
        feePct: fee / 10_000,
        tvlUsd: p.reserveUsd,
        vol24Usd: p.volume.h24,
        fees24Usd,
        feeYieldDayPct,
        aprPct: feeYieldDayPct * 365,
        volTvl: p.volume.h24 / p.reserveUsd,
        sigma24Pct: null,
        score: null,
        ranges: null,
        href: `/x/bsc/${p.baseToken}`,
        executable: /WBNB|\/ BNB|BNB \//.test(p.name),
      })
    }
    return out
  })
}

// ---------------------------------------------------------------------------

/** Realized 24h σ (percent) from minute candles, for chains we don't index. */
const sigmaCache = new Map<string, { at: number; sigma: number | null }>()
export async function sigmaFromGecko(chain: 'sol' | 'bsc', pool: string): Promise<number | null> {
  const key = `${chain}:${pool}`
  const hit = sigmaCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.sigma
  let sigma: number | null = null
  try {
    const candles = await poolCandles(chain, pool, 'minute', 1, 300)
    const closes = candles.map((c) => c.close).filter((c) => c > 0)
    if (closes.length >= 60) {
      const rets: number[] = []
      for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i]! / closes[i - 1]!))
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length
      const varc = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1)
      sigma = Math.sqrt(varc) * Math.sqrt(1440) * 100
    }
  } catch {
    sigma = null
  }
  sigmaCache.set(key, { at: Date.now(), sigma })
  return sigma
}

export interface LpScreen {
  rows: LpPoolRow[]
  errors: string[]
  at: number
}

/**
 * All venues, one ranking. σ is fetched for the top `sigmaFor` rows by fee
 * yield (GeckoTerminal is rate-limited), the rest show yield without a score.
 */
export async function lpScreen(chains: XChain[] = ['rh', 'sol', 'bsc'], perSource = 20, sigmaFor = 18): Promise<LpScreen> {
  const errors: string[] = []
  const sources: Promise<LpPoolRow[]>[] = []
  if (chains.includes('rh')) sources.push(rhLpPools(perSource))
  if (chains.includes('sol')) sources.push(orcaPools(perSource), meteoraPools(perSource))
  if (chains.includes('bsc')) sources.push(pancakePools(perSource))
  const settled = await Promise.allSettled(sources)
  const rows: LpPoolRow[] = []
  for (const s of settled) {
    if (s.status === 'fulfilled') rows.push(...s.value)
    else errors.push((s.reason as Error).message)
  }
  rows.sort((a, b) => b.feeYieldDayPct - a.feeYieldDayPct)
  const need = rows.filter((r) => r.chain !== 'rh' && r.sigma24Pct === null).slice(0, sigmaFor)
  await Promise.all(
    need.map(async (r) => {
      const sigma = await sigmaFromGecko(r.chain as 'sol' | 'bsc', r.address)
      r.sigma24Pct = sigma
      r.score = score(r.feeYieldDayPct, sigma)
      r.ranges = rangesFromSigma(sigma)
    }),
  )
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.feeYieldDayPct - a.feeYieldDayPct)
  return { rows, errors, at: Date.now() }
}
