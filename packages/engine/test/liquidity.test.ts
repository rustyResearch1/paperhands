import { describe, expect, it } from 'vitest'
import {
  getAmountsForLiquidity,
  getLiquidityForAmounts,
} from '../src/v3/liquidityAmounts.js'
import { Q96, getSqrtRatioAtTick } from '../src/v3/math.js'
import { simulateV3ExactIn } from '../src/v3/swap.js'
import type { V3PoolState } from '../src/types.js'

const lower = getSqrtRatioAtTick(-600)
const upper = getSqrtRatioAtTick(600)

describe('LiquidityAmounts', () => {
  it('amounts round-trip below the funded liquidity', () => {
    const amount0 = 10n ** 18n
    const amount1 = 10n ** 18n
    for (const price of [getSqrtRatioAtTick(-1200), Q96, getSqrtRatioAtTick(1200)]) {
      const L = getLiquidityForAmounts(price, lower, upper, amount0, amount1)
      const { amount0: a0, amount1: a1 } = getAmountsForLiquidity(price, lower, upper, L)
      expect(a0).toBeLessThanOrEqual(amount0)
      expect(a1).toBeLessThanOrEqual(amount1)
      expect(L).toBeGreaterThan(0n)
    }
  })

  it('a position entirely below/above the price is single-sided', () => {
    const L = 10n ** 18n
    const below = getAmountsForLiquidity(getSqrtRatioAtTick(1200), lower, upper, L)
    expect(below.amount0).toBe(0n) // price above range → all token1
    expect(below.amount1).toBeGreaterThan(0n)
    const above = getAmountsForLiquidity(getSqrtRatioAtTick(-1200), lower, upper, L)
    expect(above.amount1).toBe(0n) // price below range → all token0
    expect(above.amount0).toBeGreaterThan(0n)
  })

  it('at mid-range the position holds both sides', () => {
    const { amount0, amount1 } = getAmountsForLiquidity(Q96, lower, upper, 10n ** 21n)
    expect(amount0).toBeGreaterThan(0n)
    expect(amount1).toBeGreaterThan(0n)
  })
})

describe('swap trace', () => {
  const OUTER = 10n ** 21n
  const INNER = 5n * 10n ** 21n
  const pool: V3PoolState = {
    sqrtPriceX96: Q96,
    tick: 0,
    liquidity: OUTER + INNER,
    feePips: 3000,
    tickSpacing: 60,
    ticks: [
      { tick: -120000, liquidityNet: OUTER },
      { tick: -600, liquidityNet: INNER },
      { tick: 600, liquidityNet: -INNER },
      { tick: 120000, liquidityNet: -OUTER },
    ],
    tickWindow: { min: -120000, max: 120000 },
  }

  it('steps sum exactly to the totals', () => {
    const r = simulateV3ExactIn(pool, 10n ** 21n, false, { trace: true })
    expect(r.steps).toBeDefined()
    expect(r.steps!.length).toBeGreaterThan(1) // crossed the inner band
    const sumIn = r.steps!.reduce((a, s) => a + s.amountIn + s.feeAmount, 0n)
    const sumOut = r.steps!.reduce((a, s) => a + s.amountOut, 0n)
    const sumFee = r.steps!.reduce((a, s) => a + s.feeAmount, 0n)
    expect(sumIn).toBe(r.amountIn)
    expect(sumOut).toBe(r.amountOut)
    expect(sumFee).toBe(r.feeAmount)
  })

  it('trace off by default keeps the result shape unchanged', () => {
    const r = simulateV3ExactIn(pool, 10n ** 18n, false)
    expect(r.steps).toBeUndefined()
  })
})
