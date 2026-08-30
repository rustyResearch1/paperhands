import type { Quote, SwapResult, TickData, V3PoolState } from '../types.js'
import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  computeSwapStep,
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
} from './math.js'

const MAX_STEPS = 1024

interface NextTick {
  tick: number
  initialized: boolean
}

/** Greatest initialized tick <= from (down) or least > from (up). */
function nextInitializedTick(ticks: TickData[], from: number, zeroForOne: boolean): NextTick | undefined {
  if (zeroForOne) {
    for (let i = ticks.length - 1; i >= 0; i--) {
      const t = ticks[i]!
      if (t.tick <= from) return { tick: t.tick, initialized: true }
    }
    return undefined
  }
  for (const t of ticks) {
    if (t.tick > from) return { tick: t.tick, initialized: true }
  }
  return undefined
}

/** True when the fetched tick window stops short of the chain's tick range in this direction. */
function windowIsPartial(zeroForOne: boolean, windowMin: number, windowMax: number): boolean {
  return zeroForOne ? windowMin > MIN_TICK : windowMax < MAX_TICK
}

function liquidityNetAt(ticks: TickData[], tick: number): bigint {
  for (const t of ticks) if (t.tick === tick) return t.liquidityNet
  return 0n
}

/**
 * Simulate an exact-input swap through a v3 pool, walking initialized ticks
 * exactly the way UniswapV3Pool.swap does. `zeroForOne` means the input is
 * token0. Stops early (partial fill) when liquidity or the known tick window
 * runs out instead of reverting.
 */
export function simulateV3ExactIn(pool: V3PoolState, amountIn: bigint, zeroForOne: boolean): SwapResult {
  if (amountIn < 0n) throw new Error('simulateV3ExactIn: negative amountIn')

  const windowMin = pool.tickWindow?.min ?? MIN_TICK
  const windowMax = pool.tickWindow?.max ?? MAX_TICK
  const sqrtPriceLimitX96 = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n

  let remaining = amountIn
  let amountOut = 0n
  let feeTotal = 0n
  let sqrtPriceX96 = pool.sqrtPriceX96
  let tick = pool.tick
  let liquidity = pool.liquidity
  let ticksCrossed = 0
  let exhaustedWindow = false

  let steps = 0
  while (remaining > 0n && sqrtPriceX96 !== sqrtPriceLimitX96 && steps++ < MAX_STEPS) {
    const next = nextInitializedTick(pool.ticks, tick, zeroForOne)

    let tickNext: number
    let initialized: boolean
    if (next) {
      tickNext = next.tick
      initialized = next.initialized
    } else {
      // Off the edge of what we know. Walk to the window boundary, then stop.
      tickNext = zeroForOne ? windowMin : windowMax
      initialized = false
    }
    if (tickNext < MIN_TICK) tickNext = MIN_TICK
    else if (tickNext > MAX_TICK) tickNext = MAX_TICK

    const sqrtPriceNextX96 = getSqrtRatioAtTick(tickNext)
    const target =
      (zeroForOne ? sqrtPriceNextX96 < sqrtPriceLimitX96 : sqrtPriceNextX96 > sqrtPriceLimitX96)
        ? sqrtPriceLimitX96
        : sqrtPriceNextX96

    const step = computeSwapStep(sqrtPriceX96, target, liquidity, remaining, pool.feePips)
    sqrtPriceX96 = step.sqrtRatioNextX96
    remaining -= step.amountIn + step.feeAmount
    amountOut += step.amountOut
    feeTotal += step.feeAmount

    if (sqrtPriceX96 === sqrtPriceNextX96) {
      if (initialized) {
        const net = liquidityNetAt(pool.ticks, tickNext)
        liquidity += zeroForOne ? -net : net
        ticksCrossed++
        if (liquidity < 0n) throw new Error('simulateV3ExactIn: negative liquidity after cross')
      }
      tick = zeroForOne ? tickNext - 1 : tickNext
      if (!initialized) {
        if (remaining > 0n && windowIsPartial(zeroForOne, windowMin, windowMax)) exhaustedWindow = true
        break
      }
    } else if (sqrtPriceX96 !== pool.sqrtPriceX96) {
      tick = getTickAtSqrtRatio(sqrtPriceX96)
    }

    // No liquidity and nothing left to cross into: stop instead of spinning.
    if (liquidity === 0n && !nextInitializedTick(pool.ticks, tick, zeroForOne)) {
      if (remaining > 0n && windowIsPartial(zeroForOne, windowMin, windowMax)) exhaustedWindow = true
      break
    }
  }

  const consumed = amountIn - remaining
  return {
    amountIn: consumed,
    amountOut,
    feeAmount: feeTotal,
    sqrtPriceX96After: sqrtPriceX96,
    tickAfter: tick,
    liquidityAfter: liquidity,
    ticksCrossed,
    fillRatio: amountIn === 0n ? 1 : Number(consumed) / Number(amountIn),
    exhaustedWindow,
  }
}

function sqrtToPrice(sqrtPriceX96: bigint): number {
  return (Number(sqrtPriceX96) / 2 ** 96) ** 2
}

/** Full quote with honesty metrics. Prices are raw-unit ratios (out per in). */
export function quoteV3ExactIn(pool: V3PoolState, amountIn: bigint, zeroForOne: boolean): Quote {
  const r = simulateV3ExactIn(pool, amountIn, zeroForOne)

  const p0Before = sqrtToPrice(pool.sqrtPriceX96)
  const p0After = sqrtToPrice(r.sqrtPriceX96After)
  const spotPriceBefore = zeroForOne ? p0Before : 1 / p0Before
  const spotPriceAfter = zeroForOne ? p0After : 1 / p0After

  const executionPrice = r.amountIn > 0n ? Number(r.amountOut) / Number(r.amountIn) : 0
  const inExclFee = r.amountIn - r.feeAmount
  const execExclFee = inExclFee > 0n ? Number(r.amountOut) / Number(inExclFee) : 0
  const priceImpactBps =
    spotPriceBefore > 0 && execExclFee > 0 ? Math.max(0, (1 - execExclFee / spotPriceBefore) * 10_000) : 0

  return {
    ...r,
    executionPrice,
    spotPriceBefore,
    spotPriceAfter,
    priceImpactBps,
    feeBps: pool.feePips / 100,
  }
}

/** Pool state after applying a simulated swap (ticks are static data, so reuse them). */
export function poolStateAfter(pool: V3PoolState, r: SwapResult): V3PoolState {
  return {
    ...pool,
    sqrtPriceX96: r.sqrtPriceX96After,
    tick: r.tickAfter,
    liquidity: r.liquidityAfter,
  }
}
