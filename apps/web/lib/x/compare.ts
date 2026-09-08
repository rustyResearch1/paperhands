import { db } from '../db'
import { swr } from '../swr'
import { ethUsdRate } from '../usd'
import { simplePriceUsd } from './gecko'
import { xquote, xtoken } from './index'
import { NATIVE, type XChain, type XQuote } from './types'

/**
 * Best execution across chains: the same dollars into the same asset on
 * every chain that has it. Effective cost = 1 − (USD value received / USD
 * spent), which folds in LP fees, price impact and aggregator spread; gas is
 * shown separately where a venue estimates it.
 */
export interface CompareAsset {
  key: string
  label: string
  /** Token per chain; 'native' = it is the chain's gas asset; null = not listed. */
  tokens: Record<XChain, string | null>
}

export const COMPARE_ASSETS: CompareAsset[] = [
  { key: 'usd', label: 'Dollar (USDC · USDG)', tokens: { rh: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', sol: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', bsc: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' } },
  { key: 'usdt', label: 'USDT', tokens: { rh: null, sol: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', bsc: '0x55d398326f99059ff775485246999027b3197955' } },
  { key: 'eth', label: 'ETH', tokens: { rh: 'native', sol: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', bsc: '0x2170ed0880ac9a755fd29b2688956bd959f933f8' } },
  { key: 'btc', label: 'BTC (cbBTC · BTCB)', tokens: { rh: null, sol: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', bsc: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c' } },
  { key: 'sol', label: 'SOL', tokens: { rh: null, sol: 'native', bsc: '0x570a5d26f7765ecb712c0924e4de545b89fd43df' } },
]

export interface CompareCell {
  chain: XChain
  token: string | null
  native?: boolean
  amountOut?: string
  decimals?: number
  symbol?: string
  valueUsd?: number
  costBps?: number
  impactBps?: number | null
  gasUsd?: number | null
  source?: XQuote['route']['source']
  route?: string
  error?: string
}

export interface CompareRow {
  asset: CompareAsset
  cells: CompareCell[]
  /** Chain with the lowest effective cost among quoted cells. */
  best: XChain | null
}

export async function nativePrices(): Promise<Record<XChain, number | null>> {
  const [solPx, bnbPx] = await Promise.all([
    fetch(`https://lite-api.jup.ag/price/v3?ids=${NATIVE.sol.address}`, { cache: 'no-store' })
      .then((r) => r.json() as Promise<Record<string, { usdPrice: number }>>)
      .then((j) => j[NATIVE.sol.address]?.usdPrice ?? null)
      .catch(() => null),
    simplePriceUsd('bsc', [NATIVE.bsc.wrapped!])
      .then((m) => m[NATIVE.bsc.wrapped!.toLowerCase()] ?? null)
      .catch(() => null),
  ])
  return { rh: ethUsdRate(), sol: solPx, bsc: bnbPx }
}

/** USD price of a token on a chain, for valuing what a quote returns. */
async function tokenPricesUsd(chain: XChain, tokens: string[]): Promise<Record<string, number>> {
  if (tokens.length === 0) return {}
  if (chain === 'sol') {
    const j = (await (await fetch(`https://lite-api.jup.ag/price/v3?ids=${tokens.join(',')}`, { cache: 'no-store' })).json()) as Record<string, { usdPrice: number }>
    return Object.fromEntries(tokens.map((t) => [t, j[t]?.usdPrice ?? 0]))
  }
  if (chain === 'bsc') return simplePriceUsd('bsc', tokens)
  // Robinhood Chain: USDG is the dollar; anything else from our candles × ETH/USD.
  const rate = ethUsdRate() ?? 0
  const out: Record<string, number> = {}
  for (const t of tokens) {
    if (t === COMPARE_ASSETS[0]!.tokens.rh) {
      out[t] = 1
      continue
    }
    const row = db
      .prepare(
        `SELECT (SELECT close FROM candles c WHERE c.pool = p.address ORDER BY minute_ts DESC LIMIT 1) AS close, COALESCE(p.quote_symbol,'WETH') AS q
         FROM pools p WHERE p.factory_verified = 1 AND p.base_is_token0 IS NOT NULL
           AND (CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END) = ? ORDER BY p.swap_count DESC LIMIT 1`,
      )
      .get(t) as { close: number | null; q: string } | undefined
    out[t] = row?.close ? row.close * (row.q === 'USDG' ? 1 : rate) : 0
  }
  return out
}

/** Fresh for a minute; a stale table is served instantly while one refresh runs behind it. */
export function compareAcrossChains(usd: number): Promise<{ rows: CompareRow[]; nativeUsd: Record<XChain, number | null> }> {
  return swr(`compare:${usd}`, 60_000, () => computeCompare(usd))
}

async function computeCompare(usd: number): Promise<{ rows: CompareRow[]; nativeUsd: Record<XChain, number | null> }> {
  const nativeUsd = await nativePrices()
  const chains: XChain[] = ['rh', 'sol', 'bsc']
  const priceMaps = Object.fromEntries(
    await Promise.all(
      chains.map(async (c) => [c, await tokenPricesUsd(c, COMPARE_ASSETS.map((a) => a.tokens[c]).filter((t): t is string => Boolean(t) && t !== 'native')).catch(() => ({}))] as const),
    ),
  ) as Record<XChain, Record<string, number>>

  const rows: CompareRow[] = await Promise.all(
    COMPARE_ASSETS.map(async (asset) => {
      const cells: CompareCell[] = await Promise.all(
        chains.map(async (chain): Promise<CompareCell> => {
          const token = asset.tokens[chain]
          if (!token) return { chain, token: null }
          if (token === 'native') return { chain, token, native: true, costBps: 0, gasUsd: 0 }
          const px = nativeUsd[chain]
          if (!px) return { chain, token, error: 'no native price' }
          const amountIn = BigInt(Math.round((usd / px) * 1e6)) * 10n ** BigInt(NATIVE[chain].decimals - 6)
          try {
            const [q, meta] = await Promise.all([xquote(chain, 'buy', token, amountIn), xtoken(chain, token)])
            if (!meta) throw new Error('unknown token')
            const decimals = meta.decimals
            const tokenPx = priceMaps[chain]?.[token.toLowerCase()] ?? priceMaps[chain]?.[token] ?? 0
            const human = Number(BigInt(q.amountOut)) / 10 ** decimals
            const valueUsd = human * tokenPx
            return {
              chain,
              token,
              amountOut: q.amountOut,
              decimals,
              symbol: meta.symbol,
              valueUsd,
              costBps: tokenPx > 0 ? (1 - valueUsd / usd) * 10_000 : undefined,
              impactBps: q.priceImpactBps,
              gasUsd: q.gasUsd ?? null,
              source: q.route.source,
              route: q.route.label,
            }
          } catch (err) {
            return { chain, token, error: (err as Error).message.slice(0, 80) }
          }
        }),
      )
      const quoted = cells.filter((c) => c.costBps !== undefined && !c.native)
      const best = quoted.length ? quoted.reduce((a, b) => ((a.costBps ?? Infinity) <= (b.costBps ?? Infinity) ? a : b)).chain : null
      return { asset, cells, best }
    }),
  )
  return { rows, nativeUsd }
}
