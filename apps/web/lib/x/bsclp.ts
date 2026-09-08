import { getAmountsForLiquidity, getSqrtRatioAtTick } from '@paperhands/engine'
import { nfpmAbi, readV3Pool } from '@paperhands/chain'
import type { Address } from 'viem'
import { PANCAKE, WBNB, bscClient, pairPools } from './bsc'
import { sigmaFromGecko } from './lp'

/**
 * LP on BNB Chain through PancakeSwap v3 — a Uniswap v3 fork, so the
 * position manager, the tick math and our mint/collect/close builders all
 * carry over. Deposits are sized in BNB (the WBNB side is sent as native and
 * wrapped by the manager); the token side must already be in the wallet.
 */
export interface BscPoolChoice {
  pool: string
  fee: number
  tickSpacing: number
  tick: number
  liquidity: string
  /** Quote-side (WBNB) active-range depth, human BNB. */
  depthBnb: number
  wbnbIsToken0: boolean
}

export interface BscMintPlan {
  pool: string
  token0: string
  token1: string
  fee: number
  tickSpacing: number
  tickLower: number
  tickUpper: number
  currentTick: number
  liquidity: string
  amount0: string
  amount1: string
  wethIs: 0 | 1 | null
  baseIsToken0: boolean
}

/** PancakeSwap v3 WBNB pools for a token, with live state. */
export async function bscPoolsFor(token: string): Promise<BscPoolChoice[]> {
  const pools = await pairPools(token as Address, WBNB)
  const out: BscPoolChoice[] = []
  for (const p of pools) {
    try {
      const snap = await readV3Pool(bscClient, p.address, 1, undefined, PANCAKE.tickLens)
      const s = snap.state
      const wbnbIsToken0 = p.token0.toLowerCase() === WBNB.toLowerCase()
      const sqrt = Number(s.sqrtPriceX96) / 2 ** 96
      const depthRaw = wbnbIsToken0 ? Number(s.liquidity) / sqrt : Number(s.liquidity) * sqrt
      out.push({ pool: p.address, fee: p.fee, tickSpacing: s.tickSpacing, tick: s.tick, liquidity: s.liquidity.toString(), depthBnb: depthRaw / 1e18, wbnbIsToken0 })
    } catch {
      // unreadable pool; skip
    }
  }
  return out.sort((a, b) => b.depthBnb - a.depthBnb)
}

const clamp = (v: number) => Math.min(300, Math.max(3, Math.round(v)))

export async function bscRanges(pool: string): Promise<{ sigma24Pct: number | null; ranges: { label: string; pct: number; note: string }[] }> {
  const sigma = await sigmaFromGecko('bsc', pool)
  const s = sigma ?? 30
  return {
    sigma24Pct: sigma,
    ranges: [
      { label: 'tight', pct: clamp(s), note: 'Max fee capture; expect to leave range within a day.' },
      { label: 'balanced', pct: clamp(s * 2), note: 'Covers a typical day.' },
      { label: 'wide', pct: clamp(s * 4), note: 'Survives a violent day; lowest fee density.' },
    ],
  }
}

export async function planBscMint(pool: string, rangePct: number, bnbWei: bigint): Promise<BscMintPlan> {
  const snap = await readV3Pool(bscClient, pool as Address, 1, undefined, PANCAKE.tickLens)
  const s = snap.state
  const token0 = snap.token0.address.toLowerCase()
  const token1 = snap.token1.address.toLowerCase()
  const wbnb = WBNB.toLowerCase()
  const wethIs: 0 | 1 | null = token0 === wbnb ? 0 : token1 === wbnb ? 1 : null
  if (wethIs === null) throw new Error('only WBNB-paired pools can be opened with a BNB deposit')
  const spacing = s.tickSpacing
  const span = Math.round(Math.log(1 + rangePct / 100) / Math.log(1.0001))
  const tickLower = Math.floor((s.tick - span) / spacing) * spacing
  const tickUpper = Math.max(Math.ceil((s.tick + span) / spacing) * spacing, tickLower + spacing)
  const sqrtL = getSqrtRatioAtTick(tickLower)
  const sqrtU = getSqrtRatioAtTick(tickUpper)
  // "base" is the non-WBNB side, mirroring the Robinhood Chain planner.
  const baseIsToken0 = wethIs === 1
  const probe = 10n ** 18n
  const pa = getAmountsForLiquidity(s.sqrtPriceX96, sqrtL, sqrtU, probe)
  const praw = (Number(s.sqrtPriceX96) / 2 ** 96) ** 2
  const valuePerProbe = baseIsToken0 ? Number(pa.amount1) + Number(pa.amount0) * praw : Number(pa.amount0) + Number(pa.amount1) / praw
  if (valuePerProbe <= 0) throw new Error('range holds no value at the current price')
  const liquidity = BigInt(Math.floor((Number(bnbWei) / valuePerProbe) * 1e18))
  const amounts = getAmountsForLiquidity(s.sqrtPriceX96, sqrtL, sqrtU, liquidity)
  return {
    pool: pool.toLowerCase(),
    token0,
    token1,
    fee: s.feePips,
    tickSpacing: spacing,
    tickLower,
    tickUpper,
    currentTick: s.tick,
    liquidity: liquidity.toString(),
    amount0: amounts.amount0.toString(),
    amount1: amounts.amount1.toString(),
    wethIs,
    baseIsToken0,
  }
}

export interface BscLpPosition {
  tokenId: string
  pool: string | null
  token0: string
  token1: string
  symbol0: string
  symbol1: string
  decimals0: number
  decimals1: number
  fee: number
  tickLower: number
  tickUpper: number
  currentTick: number | null
  inRange: boolean
  liquidity: string
  amount0: string
  amount1: string
  owed0: string
  owed1: string
  /** Position value at mid, in BNB (null when neither side is WBNB). */
  valueBnb: number | null
}

/** PancakeSwap v3 LP NFTs a wallet holds, with live amounts and range status. */
export async function bscLpPositions(owner: string): Promise<BscLpPosition[]> {
  const nfpm = { address: PANCAKE.positionManager, abi: nfpmAbi } as const
  const o = owner as Address
  const count = Number(await bscClient.readContract({ ...nfpm, functionName: 'balanceOf', args: [o] }))
  const ids = await Promise.all(Array.from({ length: Math.min(count, 25) }, (_, i) => bscClient.readContract({ ...nfpm, functionName: 'tokenOfOwnerByIndex', args: [o, BigInt(i)] })))
  const out: BscLpPosition[] = []
  for (const id of ids) {
    const p = await bscClient.readContract({ ...nfpm, functionName: 'positions', args: [id] })
    const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , owed0, owed1] = p
    if (liquidity === 0n && owed0 === 0n && owed1 === 0n) continue
    const pools = await pairPools(token0, token1).catch(() => [])
    const pool = pools.find((x) => x.fee === fee) ?? null
    let currentTick: number | null = null
    let amount0 = 0n
    let amount1 = 0n
    let valueBnb: number | null = null
    let meta: { s0: string; s1: string; d0: number; d1: number } = { s0: token0.slice(0, 6), s1: token1.slice(0, 6), d0: 18, d1: 18 }
    if (pool) {
      try {
        const snap = await readV3Pool(bscClient, pool.address, 1, undefined, PANCAKE.tickLens)
        currentTick = snap.state.tick
        const a = getAmountsForLiquidity(snap.state.sqrtPriceX96, getSqrtRatioAtTick(tickLower), getSqrtRatioAtTick(tickUpper), liquidity)
        amount0 = a.amount0
        amount1 = a.amount1
        meta = { s0: snap.token0.symbol, s1: snap.token1.symbol, d0: snap.token0.decimals, d1: snap.token1.decimals }
        const praw = (Number(snap.state.sqrtPriceX96) / 2 ** 96) ** 2
        const wbnb = WBNB.toLowerCase()
        if (token0.toLowerCase() === wbnb) valueBnb = (Number(amount0) + Number(amount1) / praw) / 1e18
        else if (token1.toLowerCase() === wbnb) valueBnb = (Number(amount1) + Number(amount0) * praw) / 1e18
      } catch {
        // pool unreadable right now
      }
    }
    out.push({
      tokenId: id.toString(),
      pool: pool?.address ?? null,
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      symbol0: meta.s0,
      symbol1: meta.s1,
      decimals0: meta.d0,
      decimals1: meta.d1,
      fee,
      tickLower,
      tickUpper,
      currentTick,
      inRange: currentTick !== null && tickLower <= currentTick && currentTick < tickUpper,
      liquidity: liquidity.toString(),
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      owed0: owed0.toString(),
      owed1: owed1.toString(),
      valueBnb,
    })
  }
  return out
}
