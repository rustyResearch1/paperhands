import { describe, expect, it } from 'vitest'
import { EMPTY_POSITION, applyBuy, applySell, unrealizedQuote } from '../src/pnl.js'

describe('position accounting', () => {
  it('tracks average cost through buys and realizes on sells', () => {
    let pos = applyBuy(EMPTY_POSITION, 100n, 50n) // 100 tokens for 50 quote
    pos = applyBuy(pos, 100n, 150n) // 100 more for 150 → avg cost 1.0
    expect(pos.qty).toBe(200n)
    expect(pos.costQuote).toBe(200n)

    pos = applySell(pos, 50n, 90n) // sell 50 (basis 50) for 90 → +40 realized
    expect(pos.qty).toBe(150n)
    expect(pos.costQuote).toBe(150n)
    expect(pos.realizedQuote).toBe(40n)
  })

  it('full exit leaves zero basis', () => {
    let pos = applyBuy(EMPTY_POSITION, 1000n, 500n)
    pos = applySell(pos, 1000n, 400n)
    expect(pos.qty).toBe(0n)
    expect(pos.costQuote).toBe(0n)
    expect(pos.realizedQuote).toBe(-100n)
  })

  it('unrealized PnL is realizable value minus basis', () => {
    const pos = applyBuy(EMPTY_POSITION, 100n, 100n)
    expect(unrealizedQuote(pos, 130n)).toBe(30n)
    expect(unrealizedQuote(pos, 70n)).toBe(-30n)
  })

  it('refuses to sell more than held', () => {
    const pos = applyBuy(EMPTY_POSITION, 10n, 10n)
    expect(() => applySell(pos, 11n, 20n)).toThrow()
  })
})
