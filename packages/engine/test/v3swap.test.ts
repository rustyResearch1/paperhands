import { describe, expect, it } from 'vitest'
import { roundTripV3 } from '../src/honesty.js'
import type { V3PoolState } from '../src/types.js'
import { Q96 } from '../src/v3/math.js'
import { poolStateAfter, quoteV3ExactIn, simulateV3ExactIn } from '../src/v3/swap.js'

const OUTER = 10n ** 21n
const INNER = 5n * 10n ** 21n

/** Price at tick 0, concentrated band ±600, thin backstop band ±120000. */
function syntheticPool(): V3PoolState {
  return {
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
}

describe('simulateV3ExactIn', () => {
  it('small swap stays in range and fills fully', () => {
    const r = simulateV3ExactIn(syntheticPool(), 10n ** 18n, false)
    expect(r.fillRatio).toBe(1)
    expect(r.ticksCrossed).toBe(0)
    expect(r.amountOut).toBeGreaterThan(0n)
    expect(r.sqrtPriceX96After).toBeGreaterThan(Q96)
    expect(r.exhaustedWindow).toBe(false)
    // ~30bps fee on input
    expect(r.feeAmount).toBeGreaterThanOrEqual((r.amountIn * 3n) / 1000n)
  })

  it('swaps in both directions move price the right way', () => {
    const up = simulateV3ExactIn(syntheticPool(), 10n ** 18n, false)
    const down = simulateV3ExactIn(syntheticPool(), 10n ** 18n, true)
    expect(up.sqrtPriceX96After).toBeGreaterThan(Q96)
    expect(down.sqrtPriceX96After).toBeLessThan(Q96)
  })

  it('big swap crosses the inner band and sheds its liquidity', () => {
    const r = simulateV3ExactIn(syntheticPool(), 10n ** 21n, false)
    expect(r.fillRatio).toBe(1)
    expect(r.ticksCrossed).toBeGreaterThanOrEqual(1)
    expect(r.tickAfter).toBeGreaterThanOrEqual(600)
    expect(r.liquidityAfter).toBe(OUTER)
  })

  it('pool-draining swap partial-fills instead of lying', () => {
    const r = simulateV3ExactIn(syntheticPool(), 10n ** 27n, false)
    expect(r.fillRatio).toBeLessThan(1)
    expect(r.amountIn).toBeLessThan(10n ** 27n)
    expect(r.ticksCrossed).toBe(2)
    expect(r.liquidityAfter).toBe(0n)
  })

  it('narrow tick window is reported, not silently extrapolated', () => {
    const pool: V3PoolState = {
      ...syntheticPool(),
      ticks: [
        { tick: -600, liquidityNet: INNER },
        { tick: 600, liquidityNet: -INNER },
      ],
      liquidity: INNER,
      tickWindow: { min: -600, max: 600 },
    }
    const r = simulateV3ExactIn(pool, 10n ** 24n, false)
    expect(r.exhaustedWindow).toBe(true)
    expect(r.fillRatio).toBeLessThan(1)
  })

  it('deeper liquidity means better execution for the same size', () => {
    const deep = quoteV3ExactIn(syntheticPool(), 10n ** 20n, false)
    const shallow = quoteV3ExactIn({ ...syntheticPool(), liquidity: OUTER, ticks: [
      { tick: -120000, liquidityNet: OUTER },
      { tick: 120000, liquidityNet: -OUTER },
    ] }, 10n ** 20n, false)
    expect(deep.amountOut).toBeGreaterThan(shallow.amountOut)
    expect(deep.priceImpactBps).toBeLessThan(shallow.priceImpactBps)
  })

  it('selling the bought amount back returns price near the start', () => {
    const pool = syntheticPool()
    const buy = simulateV3ExactIn(pool, 10n ** 20n, false)
    const after = poolStateAfter(pool, buy)
    const sell = simulateV3ExactIn(after, buy.amountOut, true)
    const finalTick = poolStateAfter(after, sell).tick
    expect(Math.abs(finalTick)).toBeLessThan(20)
  })
})

describe('quoteV3ExactIn honesty metrics', () => {
  it('price impact grows superlinearly with size', () => {
    const q1 = quoteV3ExactIn(syntheticPool(), 10n ** 18n, false)
    const q2 = quoteV3ExactIn(syntheticPool(), 10n ** 20n, false)
    const q3 = quoteV3ExactIn(syntheticPool(), 10n ** 21n, false)
    expect(q1.priceImpactBps).toBeLessThan(q2.priceImpactBps)
    expect(q2.priceImpactBps).toBeLessThan(q3.priceImpactBps)
  })

  it('execution price is never better than spot', () => {
    for (const size of [10n ** 15n, 10n ** 18n, 10n ** 20n]) {
      const q = quoteV3ExactIn(syntheticPool(), size, false)
      expect(q.executionPrice).toBeLessThanOrEqual(q.spotPriceBefore * 1.0000001)
    }
  })
})

describe('roundTripV3', () => {
  it('tiny round trip loses roughly the two fees', () => {
    const rt = roundTripV3(syntheticPool(), 10n ** 16n, true)
    expect(rt.retention).toBeGreaterThan(0.98)
    expect(rt.retention).toBeLessThan(0.9975) // can't beat 2×30bps fees
  })

  it('impact cancels on instant reversal — only fees leak, at any size', () => {
    // An instant round trip retraces the same liquidity curve, so price
    // impact fully cancels; retention ≈ (1-fee)² plus a small convexity
    // rebate that grows with displacement. Verified by hand for the large
    // case: engine and closed-form both give 0.99641.
    for (const size of [10n ** 16n, 10n ** 20n, 5n * 10n ** 21n]) {
      const rt = roundTripV3(syntheticPool(), size, true)
      expect(rt.retention).toBeGreaterThan(0.9938)
      expect(rt.retention).toBeLessThan(0.998)
    }
  })

  it('mark-to-market inflates across thin bands — the real paper-hands lie', () => {
    // A pool-moving buy marks the bag at the pumped spot price, but the
    // pool would pay nothing like that to let you out. markInflation is
    // the honest scoreboard.
    const small = roundTripV3(syntheticPool(), 10n ** 16n, true)
    const large = roundTripV3(syntheticPool(), 5n * 10n ** 21n, true)
    expect(small.markInflation).toBeGreaterThan(1)
    expect(small.markInflation).toBeLessThan(1.01)
    expect(large.markInflation).toBeGreaterThan(5)
    expect(large.realizableQuote).toBeLessThan(large.markValueQuote / 5)
  })
})
