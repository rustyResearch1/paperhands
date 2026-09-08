import { readV3Pool } from '@paperhands/chain'
import type { Address } from 'viem'
import { PANCAKE, bscClient } from './bsc'
import { poolCandles } from './gecko'
import { orcaPoolLiquidity } from './sollp'

/**
 * Volume-share LP backtest for chains we don't index: minute candles (USD)
 * plus the pool's current in-range liquidity. A position of `depositUsd` at
 * ±rangePct around the entry price earns, each minute it is in range,
 *   candleVolume × fee × L / (L + Lpool)
 * and ends worth what concentrated liquidity is worth at the final price.
 * Approximate by construction (pool liquidity assumed constant, fees at the
 * pool's static rate) and labelled so; the Robinhood Chain backtest replays
 * every swap exactly and is the honest reference.
 */
export interface XBacktest {
  chain: 'sol' | 'bsc'
  pool: string
  hours: number
  candles: number
  depositUsd: number
  rangePct: number
  entryPrice: number
  exitPrice: number
  lower: number
  upper: number
  inRangePct: number
  feesUsd: number
  /** Position value − value of the initial tokens held unchanged (impermanent loss, ≤ 0 usually). */
  ilUsd: number
  positionValueUsd: number
  holdValueUsd: number
  netUsd: number
  netPct: number
  aprPct: number
  poolFeePct: number
  /** Our share of in-range liquidity right after entry. */
  sharePct: number
}

/** Concentrated-liquidity amounts (human units) for liquidity L over [pl, pu] at price p. */
function amountsAt(L: number, p: number, pl: number, pu: number): { base: number; quote: number } {
  const sqp = Math.sqrt(p)
  const sql = Math.sqrt(pl)
  const squ = Math.sqrt(pu)
  if (p <= pl) return { base: L * (1 / sql - 1 / squ), quote: 0 }
  if (p >= pu) return { base: 0, quote: L * (squ - sql) }
  return { base: L * (1 / sqp - 1 / squ), quote: L * (sqp - sql) }
}

export async function xLpBacktest(chain: 'sol' | 'bsc', pool: string, rangePct: number, depositUsd: number, hours: number): Promise<XBacktest> {
  const minutes = Math.min(1000, Math.max(30, Math.round(hours * 60)))
  const [candles, liq] = await Promise.all([poolCandles(chain, pool, 'minute', 1, minutes), poolLiquidity(chain, pool)])
  if (candles.length < 30) throw new Error('not enough candle history for this pool')
  const entry = candles[0]!.close
  const exit = candles[candles.length - 1]!.close
  const lower = entry * (1 - rangePct / 100)
  const upper = entry * (1 + rangePct / 100)
  if (!(entry > 0) || lower <= 0) throw new Error('bad price series')

  // Size L (in USD-quote units) so the position is worth depositUsd at entry.
  const unit = amountsAt(1, entry, lower, upper)
  const valuePerL = unit.quote + unit.base * entry
  if (valuePerL <= 0) throw new Error('range holds no value at the entry price')
  const L = depositUsd / valuePerL
  const initial = amountsAt(L, entry, lower, upper)

  // Pool liquidity in the same (USD-quote, human) units: L_usd = L_quote × √(usd per quote).
  // Lpool comes in human quote units (token decimals removed); convert with the quote's USD price.
  const lpoolUsd = liq.liquidityHumanQuote * Math.sqrt(liq.quoteUsd)
  const share = L / (L + lpoolUsd)

  let fees = 0
  let inRange = 0
  for (const c of candles) {
    const lo = Math.min(c.open, c.close)
    const hi = Math.max(c.open, c.close)
    // Fraction of this minute's trading that happened inside the range.
    const overlap = Math.max(0, Math.min(hi, upper) - Math.max(lo, lower))
    const span = hi - lo
    const frac = span > 0 ? overlap / span : c.close >= lower && c.close <= upper ? 1 : 0
    if (frac > 0) inRange++
    fees += c.volume * liq.feePct * 0.01 * share * frac
  }
  const finalAmounts = amountsAt(L, exit, lower, upper)
  const positionValue = finalAmounts.quote + finalAmounts.base * exit
  const holdValue = initial.quote + initial.base * exit
  const il = positionValue - holdValue
  const net = fees + il
  const elapsedH = (candles[candles.length - 1]!.ts - candles[0]!.ts) / 3600
  return {
    chain,
    pool,
    hours: elapsedH,
    candles: candles.length,
    depositUsd,
    rangePct,
    entryPrice: entry,
    exitPrice: exit,
    lower,
    upper,
    inRangePct: (inRange / candles.length) * 100,
    feesUsd: fees,
    ilUsd: il,
    positionValueUsd: positionValue,
    holdValueUsd: holdValue,
    netUsd: net,
    netPct: (net / depositUsd) * 100,
    aprPct: elapsedH > 0 ? (fees / depositUsd) * (8760 / elapsedH) * 100 : 0,
    poolFeePct: liq.feePct,
    sharePct: share * 100,
  }
}

interface PoolLiq {
  /** In-range liquidity in human quote units (L_raw / 10^((dBase + dQuote)/2)). */
  liquidityHumanQuote: number
  feePct: number
  quoteUsd: number
}

async function poolLiquidity(chain: 'sol' | 'bsc', pool: string): Promise<PoolLiq> {
  if (chain === 'bsc') {
    const snap = await readV3Pool(bscClient, pool as Address, 0, undefined, PANCAKE.tickLens)
    const d0 = snap.token0.decimals
    const d1 = snap.token1.decimals
    const raw = Number(snap.state.liquidity)
    const { simplePriceUsd } = await import('./gecko')
    const wbnb = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
    const quote = [snap.token0.address, snap.token1.address].map((a) => a.toLowerCase()).includes(wbnb) ? wbnb : snap.token1.address.toLowerCase()
    const px = await simplePriceUsd('bsc', [quote]).catch(() => ({}) as Record<string, number>)
    return { liquidityHumanQuote: raw / 10 ** ((d0 + d1) / 2), feePct: snap.state.feePips / 10_000, quoteUsd: px[quote] ?? 1 }
  }
  const o = await orcaPoolLiquidity(pool)
  return { liquidityHumanQuote: o.liquidityRaw / 10 ** ((o.decimalsA + o.decimalsB) / 2), feePct: o.feeRate / 10_000, quoteUsd: o.solUsd }
}
