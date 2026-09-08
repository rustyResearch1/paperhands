import { getAmountsForLiquidity, getSqrtRatioAtTick } from '@paperhands/engine'
import { db } from './db'
import { getSnapshot, poolMeta } from './quote'

/**
 * LP strategy: ranges sized from what the token actually does, not a
 * default ±30%. Realized volatility from 1-minute candles, scaled to a
 * 24h horizon, gives the move a range must survive.
 */
export interface RangeSuggestion {
  label: 'tight' | 'balanced' | 'wide'
  /** Half-width in percent around the current price. */
  pct: number
  /** Multiples of 24h realized volatility the range covers. */
  sigmas: number
  note: string
}

export interface Strategy {
  pool: string
  sigma24Pct: number
  candles: number
  ranges: RangeSuggestion[]
}

export function suggestRanges(pool: string): Strategy {
  const now = Math.floor(Date.now() / 1000)
  const closes = (
    db
      .prepare('SELECT close FROM candles WHERE pool = ? AND minute_ts > ? AND close > 0 ORDER BY minute_ts ASC')
      .all(pool.toLowerCase(), now - 86400) as { close: number }[]
  ).map((r) => r.close)
  let sigma24 = 0.3 // default when history is thin: assume a lively memecoin
  if (closes.length > 30) {
    const rets: number[] = []
    for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i]! / closes[i - 1]!))
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length
    const varc = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1)
    // per-minute σ → 24h σ (√1440), with candle gaps ignored (minutes without
    // trades don't contribute, which slightly understates vol)
    sigma24 = Math.sqrt(varc) * Math.sqrt(1440)
  }
  const clamp = (v: number) => Math.min(300, Math.max(3, Math.round(v * 100)))
  const ranges: RangeSuggestion[] = [
    { label: 'tight', sigmas: 1, pct: clamp(sigma24 * 1), note: 'Max fee capture; expect to leave range within a day.' },
    { label: 'balanced', sigmas: 2, pct: clamp(sigma24 * 2), note: 'Covers a typical day; the usual sweet spot on 1% pools.' },
    { label: 'wide', sigmas: 4, pct: clamp(sigma24 * 4), note: 'Survives a violent day; lowest fee density.' },
  ]
  return { pool: pool.toLowerCase(), sigma24Pct: sigma24 * 100, candles: closes.length, ranges }
}

export interface MintPlan {
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
  /** Which side is WETH (sent as native ETH and wrapped by the position manager). */
  wethIs: 0 | 1 | null
  baseIsToken0: boolean
}

/**
 * Turn "deposit X ETH at ±pct" into concrete mint parameters: aligned ticks
 * and the exact token amounts a position of that value needs at the current
 * price. The memecoin side must already be in the wallet (or bought first).
 */
export async function planMint(pool: string, rangePct: number, quoteWei: bigint): Promise<MintPlan> {
  const meta = poolMeta(pool)
  if (!meta || meta.version !== 3 || meta.hooked) throw new Error('mint planning supports hookless v3 pools')
  const row = db.prepare('SELECT token0, token1, tick_spacing FROM pools WHERE address = ?').get(pool.toLowerCase()) as {
    token0: string
    token1: string
    tick_spacing: number
  }
  const snap = await getSnapshot(pool, { fresh: true })
  const s = snap.state
  const spacing = row.tick_spacing
  const span = Math.round(Math.log(1 + rangePct / 100) / Math.log(1.0001))
  const tickLower = Math.floor((s.tick - span) / spacing) * spacing
  const tickUpper = Math.max(Math.ceil((s.tick + span) / spacing) * spacing, tickLower + spacing)
  const sqrtL = getSqrtRatioAtTick(tickLower)
  const sqrtU = getSqrtRatioAtTick(tickUpper)

  const baseIsToken0 = meta.base_is_token0 === 1
  const probe = 10n ** 18n
  const pa = getAmountsForLiquidity(s.sqrtPriceX96, sqrtL, sqrtU, probe)
  const praw = (Number(s.sqrtPriceX96) / 2 ** 96) ** 2
  const valuePerProbe = baseIsToken0 ? Number(pa.amount1) + Number(pa.amount0) * praw : Number(pa.amount0) + Number(pa.amount1) / praw
  if (valuePerProbe <= 0) throw new Error('range holds no value at the current price')
  const liquidity = BigInt(Math.floor((Number(quoteWei) / valuePerProbe) * 1e18))
  const amounts = getAmountsForLiquidity(s.sqrtPriceX96, sqrtL, sqrtU, liquidity)
  const wethAddr = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
  const wethIs: 0 | 1 | null = row.token0 === wethAddr ? 0 : row.token1 === wethAddr ? 1 : null

  return {
    pool: pool.toLowerCase(),
    token0: row.token0,
    token1: row.token1,
    fee: meta.fee,
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
