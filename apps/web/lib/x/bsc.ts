import { poolStateAfter, quoteV3ExactIn, type V3PoolState } from '@paperhands/engine'
import { readTokenMeta, readV3Pool, type ChainClient } from '@paperhands/chain'
import { createPublicClient, http, parseAbi, type Address } from 'viem'
import { bsc } from 'viem/chains'
import type { ExecLeg } from '../execute'
import { NATIVE, type XQuote, type XToken } from './types'

/**
 * BNB Chain. PancakeSwap v3 is a Uniswap v3 fork, so every pool is read
 * (slot0 + TickLens) and simulated by our exact engine — the same math that
 * matches the on-chain quoters wei-for-wei on Robinhood Chain. KyberSwap's
 * aggregator (every BSC venue, keyless API) quotes the same trade; the better
 * fill wins and the ticket says which. Both are signable from an injected
 * wallet on chain 56.
 */
export const PANCAKE = {
  v3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' as Address,
  tickLens: '0x9a489505a00cE272eAa5e07Dba6491314CaE3796' as Address,
  /** SwapRouter02-compatible (exactInputSingle / exactInput / multicall / unwrapWETH9). */
  smartRouter: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4' as Address,
  positionManager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364' as Address,
  quoterV2: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997' as Address,
  fees: [100, 500, 2500, 10_000] as const,
}
export const KYBER = { router: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5' as Address, api: 'https://aggregator-api.kyberswap.com/bsc/api/v1' }
export const WBNB = NATIVE.bsc.wrapped as Address
export const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955' as Address
export const BSC_USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' as Address
const NATIVE_BSC = NATIVE.bsc.address

const g = globalThis as unknown as { __phbsc?: ChainClient }
export const bscClient: ChainClient = (g.__phbsc ??= createPublicClient({
  chain: bsc,
  transport: http(process.env.BSC_RPC ?? 'https://bsc-dataseed.binance.org', { batch: true }),
}) as unknown as ChainClient)

const factoryAbi = parseAbi(['function getPool(address, address, uint24) view returns (address)'])

interface Pool {
  address: Address
  fee: number
  token0: Address
  token1: Address
}
const poolCache = new Map<string, { at: number; pools: Pool[] }>()

/** Direct pools between two tokens across PancakeSwap v3 fee tiers. */
export async function pairPools(a: Address, b: Address): Promise<Pool[]> {
  const key = [a.toLowerCase(), b.toLowerCase()].sort().join(':')
  const hit = poolCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.pools
  const addrs = await Promise.all(
    PANCAKE.fees.map((fee) => bscClient.readContract({ address: PANCAKE.v3Factory, abi: factoryAbi, functionName: 'getPool', args: [a, b, fee] }).catch(() => null)),
  )
  const [t0, t1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a]
  const pools: Pool[] = []
  addrs.forEach((addr, i) => {
    if (addr && addr !== '0x0000000000000000000000000000000000000000') pools.push({ address: addr, fee: PANCAKE.fees[i]!, token0: t0, token1: t1 })
  })
  poolCache.set(key, { at: Date.now(), pools })
  return pools
}

const stateCache = new Map<string, { at: number; state: V3PoolState }>()
async function poolState(pool: Address): Promise<V3PoolState> {
  const hit = stateCache.get(pool)
  if (hit && Date.now() - hit.at < 12_000) return hit.state
  const snap = await readV3Pool(bscClient, pool, 3, undefined, PANCAKE.tickLens)
  stateCache.set(pool, { at: Date.now(), state: snap.state })
  return snap.state
}

interface Leg {
  pool: Pool
  tokenIn: Address
  tokenOut: Address
  zeroForOne: boolean
  amountIn: bigint
  amountOut: bigint
  feeAmount: bigint
  fillRatio: number
  exhausted: boolean
  sqrtBefore: bigint
  sqrtAfter: bigint
  after: V3PoolState
}

async function simLeg(pool: Pool, tokenIn: Address, amountIn: bigint, override?: V3PoolState): Promise<Leg | null> {
  if (amountIn <= 0n) return null
  const state = override ?? (await poolState(pool.address))
  if (state.liquidity === 0n) return null
  const zeroForOne = tokenIn.toLowerCase() === pool.token0.toLowerCase()
  const q = quoteV3ExactIn(state, amountIn, zeroForOne)
  if (q.amountOut <= 0n) return null
  return {
    pool,
    tokenIn,
    tokenOut: zeroForOne ? pool.token1 : pool.token0,
    zeroForOne,
    amountIn: q.amountIn,
    amountOut: q.amountOut,
    feeAmount: q.feeAmount,
    fillRatio: amountIn > 0n ? Number(q.amountIn) / Number(amountIn) : 0,
    exhausted: q.exhaustedWindow,
    sqrtBefore: state.sqrtPriceX96,
    sqrtAfter: q.sqrtPriceX96After,
    after: poolStateAfter(state, q),
  }
}

const midOutPerIn = (leg: Leg, sqrt: bigint) => {
  const p = (Number(sqrt) / 2 ** 96) ** 2
  return leg.zeroForOne ? p : 1 / p
}
const complete = (legs: Leg[]) => legs.every((l) => l.fillRatio >= 0.999999 && !l.exhausted)

/** Engine routes token↔WBNB: direct pools and 2-leg via USDT/USDC. */
export async function engineRoutes(tokenIn: Address, tokenOut: Address, amountIn: bigint, overrides?: Map<string, V3PoolState>): Promise<Leg[][]> {
  const ov = (p: Pool) => overrides?.get(p.address.toLowerCase())
  const routes: Leg[][] = []
  const direct = await pairPools(tokenIn, tokenOut)
  for (const p of direct) {
    const l = await simLeg(p, tokenIn, amountIn, ov(p))
    if (l) routes.push([l])
  }
  for (const bridge of [BSC_USDT, BSC_USDC]) {
    if (bridge.toLowerCase() === tokenIn.toLowerCase() || bridge.toLowerCase() === tokenOut.toLowerCase()) continue
    const [first, second] = await Promise.all([pairPools(tokenIn, bridge), pairPools(bridge, tokenOut)])
    if (first.length === 0 || second.length === 0) continue
    const leg1s = (await Promise.all(first.map((p) => simLeg(p, tokenIn, amountIn, ov(p))))).filter((l): l is Leg => l !== null)
    for (const l1 of leg1s) {
      const leg2s = (await Promise.all(second.map((p) => simLeg(p, bridge, l1.amountOut, ov(p))))).filter((l): l is Leg => l !== null)
      for (const l2 of leg2s) routes.push([l1, l2])
    }
  }
  routes.sort((a, b) => {
    const ca = complete(a) ? 1 : 0
    const cb = complete(b) ? 1 : 0
    if (ca !== cb) return cb - ca
    const oa = a[a.length - 1]!.amountOut
    const ob = b[b.length - 1]!.amountOut
    return ob > oa ? 1 : ob < oa ? -1 : 0
  })
  return routes
}

export interface KyberRoute {
  amountOut: string
  amountInUsd: number
  amountOutUsd: number
  gasUsd: number
  legs: string[]
  routeSummary: unknown
}

export async function kyberQuote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<KyberRoute> {
  const q = new URLSearchParams({ tokenIn: tokenIn.toLowerCase(), tokenOut: tokenOut.toLowerCase(), amountIn: amountIn.toString(), gasInclude: 'true' })
  const res = await fetch(`${KYBER.api}/routes?${q}`, { headers: { 'x-client-id': 'paperhands', accept: 'application/json' }, cache: 'no-store' })
  const body = (await res.json()) as { code: number; message: string; data?: { routeSummary: { amountOut: string; amountInUsd: string; amountOutUsd: string; gasUsd: string; route: { exchange: string; poolType: string }[][] } } }
  if (!res.ok || !body.data) throw new Error(`kyberswap: ${body.message}`)
  const s = body.data.routeSummary
  const legs = s.route.map((hop) => hop.map((x) => x.exchange).filter((v, i, a) => a.indexOf(v) === i).join('+'))
  return { amountOut: s.amountOut, amountInUsd: Number(s.amountInUsd), amountOutUsd: Number(s.amountOutUsd), gasUsd: Number(s.gasUsd), legs, routeSummary: s }
}

/** Kyber's encoded transaction for a previously fetched route summary. */
export async function kyberBuild(routeSummary: unknown, sender: string, recipient: string, slippageBps: number): Promise<{ to: Address; data: `0x${string}`; value: string }> {
  const res = await fetch(`${KYBER.api}/route/build`, {
    method: 'POST',
    headers: { 'x-client-id': 'paperhands', 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ routeSummary, sender, recipient, slippageTolerance: slippageBps, deadline: Math.floor(Date.now() / 1000) + 600, source: 'paperhands' }),
    cache: 'no-store',
  })
  const body = (await res.json()) as { code: number; message: string; data?: { routerAddress: string; data: string; transactionValue: string } }
  if (!res.ok || !body.data) throw new Error(`kyberswap build: ${body.message}`)
  return { to: body.data.routerAddress as Address, data: body.data.data as `0x${string}`, value: body.data.transactionValue }
}

const tokenCache = new Map<string, XToken>()
export async function bscToken(address: string): Promise<XToken> {
  const key = address.toLowerCase()
  if (key === NATIVE_BSC) return { chain: 'bsc', address: key, symbol: 'BNB', name: 'BNB', decimals: 18 }
  const hit = tokenCache.get(key)
  if (hit) return hit
  const m = await readTokenMeta(bscClient, address as Address)
  const t: XToken = { chain: 'bsc', address: key, symbol: m.symbol, name: m.name, decimals: m.decimals }
  tokenCache.set(key, t)
  return t
}

const legName = (l: Leg, symbols: Map<string, string>) =>
  `Pancake v3 ${symbols.get(l.tokenIn.toLowerCase()) ?? l.tokenIn.slice(0, 6)}/${symbols.get(l.tokenOut.toLowerCase()) ?? l.tokenOut.slice(0, 6)} ${(l.pool.fee / 10_000).toFixed(2)}%`

export async function bscQuote(side: 'buy' | 'sell', token: string, amountIn: bigint): Promise<XQuote> {
  const tok = token as Address
  const tokenIn = side === 'buy' ? WBNB : tok
  const tokenOut = side === 'buy' ? tok : WBNB
  const meta = await bscToken(token).catch(() => null)
  const symbols = new Map<string, string>([
    [WBNB.toLowerCase(), 'BNB'],
    [BSC_USDT.toLowerCase(), 'USDT'],
    [BSC_USDC.toLowerCase(), 'USDC'],
    [token.toLowerCase(), meta?.symbol ?? token.slice(0, 6)],
  ])
  const dec = meta?.decimals ?? 18

  const [routes, kyber] = await Promise.all([
    engineRoutes(tokenIn, tokenOut, amountIn).catch(() => [] as Leg[][]),
    kyberQuote(side === 'buy' ? NATIVE_BSC : token, side === 'buy' ? token : NATIVE_BSC, amountIn).catch(() => null),
  ])
  const best = routes[0]
  const engineOut = best ? best[best.length - 1]!.amountOut : 0n
  const kyberOut = kyber ? BigInt(kyber.amountOut) : 0n
  if (!best && !kyber) throw new Error('no route on BNB Chain for this token')

  const bnbPer = (wei: bigint, units: bigint) => (units > 0n ? Number(wei) / 1e18 / (Number(units) / 10 ** dec) : null)
  const base: Omit<XQuote, 'amountIn' | 'amountOut' | 'fillRatio' | 'priceImpactBps' | 'feeBps' | 'spotPrice' | 'execPrice' | 'route' | 'exact' | 'executable' | 'exec' | 'gasUsd'> = {
    chain: 'bsc',
    side,
    token,
    tokenIn: side === 'buy' ? NATIVE_BSC : token,
    tokenOut: side === 'buy' ? token : NATIVE_BSC,
    quotedAt: Date.now(),
  }

  // Engine route wins ties: exact numbers, exact instant-exit, our own calldata.
  if (best && (complete(best) || !kyber) && engineOut >= kyberOut) {
    const first = best[0]!
    const last = best[best.length - 1]!
    const spotRaw = best.reduce((acc, l) => acc * midOutPerIn(l, l.sqrtBefore), 1)
    const execRaw = Number(last.amountOut) / Number(first.amountIn)
    const keep = best.reduce((acc, l) => acc * (1 - l.pool.fee / 1e6), 1)
    const priceImpactBps = spotRaw > 0 ? Math.max(0, (1 - execRaw / keep / spotRaw) * 10_000) : null
    const out: XQuote = {
      ...base,
      amountIn: first.amountIn.toString(),
      amountOut: last.amountOut.toString(),
      fillRatio: Math.min(...best.map((l) => l.fillRatio)),
      priceImpactBps,
      feeBps: (1 - keep) * 10_000,
      spotPrice: side === 'buy' ? (spotRaw > 0 ? (1 / spotRaw) * 10 ** (dec - 18) : null) : spotRaw * 10 ** (dec - 18),
      execPrice: side === 'buy' ? bnbPer(first.amountIn, last.amountOut) : bnbPer(last.amountOut, first.amountIn),
      route: { label: best.map((l) => legName(l, symbols)).join(' → '), legs: best.map((l) => legName(l, symbols)), source: 'engine' },
      exact: true,
      executable: complete(best),
      gasUsd: kyber?.gasUsd ?? null,
      ...(kyber ? { alt: { source: 'kyberswap' as const, amountOut: kyber.amountOut, label: kyber.legs.join(' → ') } } : {}),
      exec: {
        kind: 'pancake-v3',
        legs: best.map<ExecLeg>((l) => ({ version: 3, pool: l.pool.address, tokenIn: l.tokenIn, tokenOut: l.tokenOut, fee: l.pool.fee })),
      },
    }
    if (side === 'buy') {
      // Sell the bag straight back through the post-fill state of the pools we just moved.
      const after = new Map<string, V3PoolState>()
      for (const l of best) after.set(l.pool.address.toLowerCase(), l.after)
      const exit = await engineRoutes(tok, WBNB, last.amountOut, after).catch(() => [] as Leg[][])
      const e = exit[0]
      if (e) {
        out.instantExit = e[e.length - 1]!.amountOut.toString()
        out.retention = Number(e[e.length - 1]!.amountOut) / Number(first.amountIn)
      }
    }
    return out
  }

  const k = kyber!
  const impact = k.amountInUsd > 0 ? Math.max(0, (1 - k.amountOutUsd / k.amountInUsd) * 10_000) : null
  const out: XQuote = {
    ...base,
    amountIn: amountIn.toString(),
    amountOut: k.amountOut,
    fillRatio: 1,
    priceImpactBps: impact,
    feeBps: null,
    spotPrice: null,
    execPrice: side === 'buy' ? bnbPer(amountIn, kyberOut) : bnbPer(kyberOut, amountIn),
    route: { label: k.legs.join(' → '), legs: k.legs, source: 'kyberswap' },
    exact: false,
    executable: true,
    gasUsd: k.gasUsd,
    ...(best ? { alt: { source: 'engine' as const, amountOut: engineOut.toString(), label: best.map((l) => legName(l, symbols)).join(' → ') } } : {}),
    exec: { kind: 'kyber', routeSummary: k.routeSummary },
  }
  if (side === 'buy' && kyberOut > 0n) {
    const back = await kyberQuote(token, NATIVE_BSC, kyberOut).catch(() => null)
    if (back) {
      out.instantExit = back.amountOut
      out.retention = Number(BigInt(back.amountOut)) / Number(amountIn)
    }
  }
  return out
}
