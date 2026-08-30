import { describe, expect, it } from 'vitest'
import { quoteV2ExactIn, v2AmountIn, v2AmountOut } from '../src/v2.js'

const BPS = 10_000n

/** Uniswap v2 pair invariant with fee, as checked by the deployed contract. */
function invariantHolds(rIn: bigint, rOut: bigint, amountIn: bigint, out: bigint, feeBps: bigint): boolean {
  const adjIn = rIn * BPS + amountIn * (BPS - feeBps)
  return adjIn * (rOut - out) >= rIn * rOut * BPS
}

/** Deterministic pseudo-random bigints so failures reproduce. */
function* prng(seed: number): Generator<bigint> {
  let s = seed >>> 0
  while (true) {
    s = (s * 1664525 + 1013904223) >>> 0
    yield BigInt(s)
  }
}

describe('v2AmountOut', () => {
  it('output is maximal: invariant holds at out but breaks at out+1', () => {
    const rand = prng(42)
    for (let i = 0; i < 200; i++) {
      const rIn = (rand.next().value % 10n ** 24n) + 10n ** 6n
      const rOut = (rand.next().value % 10n ** 24n) + 10n ** 6n
      const amountIn = (rand.next().value % (rIn * 2n)) + 1n
      const out = v2AmountOut(amountIn, rIn, rOut, 30n)
      expect(invariantHolds(rIn, rOut, amountIn, out, 30n)).toBe(true)
      if (out + 1n < rOut) {
        expect(invariantHolds(rIn, rOut, amountIn, out + 1n, 30n)).toBe(false)
      }
    }
  })

  it('is monotonic in input', () => {
    const rIn = 10n ** 20n
    const rOut = 5n * 10n ** 19n
    let prev = -1n
    for (const x of [1n, 10n ** 12n, 10n ** 15n, 10n ** 18n, 10n ** 20n]) {
      const out = v2AmountOut(x, rIn, rOut)
      expect(out).toBeGreaterThanOrEqual(prev)
      prev = out
    }
  })

  it('zero and dust inputs produce zero output, never a throw', () => {
    expect(v2AmountOut(0n, 10n ** 18n, 10n ** 18n)).toBe(0n)
    expect(v2AmountOut(1n, 10n ** 24n, 1000n)).toBe(0n)
  })
})

describe('v2AmountIn', () => {
  it('round-trips: amountIn for out X actually yields at least X', () => {
    const rand = prng(7)
    for (let i = 0; i < 100; i++) {
      const rIn = (rand.next().value % 10n ** 22n) + 10n ** 9n
      const rOut = (rand.next().value % 10n ** 22n) + 10n ** 9n
      const want = (rand.next().value % (rOut / 2n)) + 1n
      const needed = v2AmountIn(want, rIn, rOut, 30n)
      expect(v2AmountOut(needed, rIn, rOut, 30n)).toBeGreaterThanOrEqual(want)
    }
  })

  it('rejects impossible outputs', () => {
    expect(() => v2AmountIn(10n ** 18n, 10n ** 18n, 10n ** 18n)).toThrow()
  })
})

describe('quoteV2ExactIn', () => {
  it('large trades against small pools report heavy impact', () => {
    const pool = { reserveIn: 10n ** 18n, reserveOut: 10n ** 18n, feeBps: 30n }
    const small = quoteV2ExactIn(pool, 10n ** 14n)
    const large = quoteV2ExactIn(pool, 10n ** 18n)
    expect(small.priceImpactBps).toBeLessThan(2)
    expect(large.priceImpactBps).toBeGreaterThan(4000) // ~50% impact for a pool-sized trade
    expect(large.amountOut).toBeLessThan(pool.reserveOut / 2n + 10n ** 15n)
  })
})
