import { describe, expect, it } from 'vitest'
import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  Q96,
  computeSwapStep,
  getAmount0Delta,
  getAmount1Delta,
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  mulDivRoundingUp,
} from '../src/v3/math.js'

describe('TickMath', () => {
  it('matches canonical anchor values', () => {
    // These three constants are hard-coded in the deployed TickMath library.
    expect(getSqrtRatioAtTick(0)).toBe(79228162514264337593543950336n)
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(MIN_SQRT_RATIO)
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(MAX_SQRT_RATIO)
  })

  it('is strictly monotonic', () => {
    const samples = [-887272, -400000, -100000, -6932, -60, -1, 0, 1, 60, 6932, 100000, 400000, 887272]
    for (let i = 1; i < samples.length; i++) {
      expect(getSqrtRatioAtTick(samples[i]!)).toBeGreaterThan(getSqrtRatioAtTick(samples[i - 1]!))
    }
  })

  it('tick(sqrt(tick)) round-trips exactly', () => {
    for (const t of [-887272, -123456, -60, -1, 0, 1, 60, 199999, 887271]) {
      expect(getTickAtSqrtRatio(getSqrtRatioAtTick(t))).toBe(t)
    }
  })

  it('getTickAtSqrtRatio returns the floor tick for prices between ticks', () => {
    const between = (getSqrtRatioAtTick(100) + getSqrtRatioAtTick(101)) / 2n
    expect(getTickAtSqrtRatio(between)).toBe(100)
  })

  it('rejects out-of-range input', () => {
    expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow()
    expect(() => getTickAtSqrtRatio(MAX_SQRT_RATIO)).toThrow()
  })
})

describe('amount deltas', () => {
  const L = 10n ** 18n
  const pLow = getSqrtRatioAtTick(-60)
  const pHigh = getSqrtRatioAtTick(60)

  it('rounding up never returns less than rounding down', () => {
    expect(getAmount0Delta(pLow, pHigh, L, true)).toBeGreaterThanOrEqual(getAmount0Delta(pLow, pHigh, L, false))
    expect(getAmount1Delta(pLow, pHigh, L, true)).toBeGreaterThanOrEqual(getAmount1Delta(pLow, pHigh, L, false))
  })

  it('is symmetric in argument order', () => {
    expect(getAmount0Delta(pLow, pHigh, L, true)).toBe(getAmount0Delta(pHigh, pLow, L, true))
    expect(getAmount1Delta(pLow, pHigh, L, false)).toBe(getAmount1Delta(pHigh, pLow, L, false))
  })

  it('amount1 across ±60 ticks of unit liquidity is ~0.6% of L·2·30bps', () => {
    // sqrt(1.0001^60) - sqrt(1.0001^-60) ≈ 0.006 of Q96 → amount1 ≈ 0.006·L
    const a1 = getAmount1Delta(pLow, pHigh, L, false)
    const approx = Number(a1) / Number(L)
    expect(approx).toBeGreaterThan(0.0059)
    expect(approx).toBeLessThan(0.0061)
  })
})

describe('computeSwapStep', () => {
  const L = 10n ** 21n
  const feePips = 3000

  it('exact-in step that stops mid-range consumes the entire remaining amount', () => {
    const current = getSqrtRatioAtTick(0)
    const target = getSqrtRatioAtTick(-600)
    const remaining = 10n ** 15n
    const step = computeSwapStep(current, target, L, remaining, feePips)
    expect(step.sqrtRatioNextX96).toBeGreaterThan(target)
    expect(step.amountIn + step.feeAmount).toBe(remaining)
    expect(step.amountOut).toBeGreaterThan(0n)
  })

  it('exact-in step that reaches the target charges fee on actual input', () => {
    const current = getSqrtRatioAtTick(0)
    const target = getSqrtRatioAtTick(-10)
    const remaining = 10n ** 24n
    const step = computeSwapStep(current, target, L, remaining, feePips)
    expect(step.sqrtRatioNextX96).toBe(target)
    expect(step.amountIn + step.feeAmount).toBeLessThan(remaining)
    expect(step.feeAmount).toBe(mulDivRoundingUp(step.amountIn, 3000n, 997000n))
  })

  it('price moves in the correct direction for both swap directions', () => {
    const current = Q96
    const down = computeSwapStep(current, getSqrtRatioAtTick(-600), L, 10n ** 15n, feePips)
    const up = computeSwapStep(current, getSqrtRatioAtTick(600), L, 10n ** 15n, feePips)
    expect(down.sqrtRatioNextX96).toBeLessThan(current)
    expect(up.sqrtRatioNextX96).toBeGreaterThan(current)
  })
})
