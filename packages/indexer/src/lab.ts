import type { ChainClient } from '@paperhands/chain'
import {
  applyBuy,
  applySell,
  EMPTY_POSITION,
  getAmountsForLiquidity,
  getSqrtRatioAtTick,
  mulDiv,
  type Position,
} from '@paperhands/engine'
import type Database from 'better-sqlite3'
import { basePriceInQuote, toHuman } from './prices.js'
import { applyLiquidityDelta, replayPool } from './history.js'

/**
 * The lab: run counterfactuals through recorded history. Both experiments are
 * parallel-universe honest — your virtual position/orders change the pool, so
 * you pay your own impact and earn only your own share.
 */

interface PoolMetaRow {
  base_is_token0: number
  tick_spacing: number
  fee: number
  baseDecimals: number
  quoteDecimals: number
  baseSymbol: string
}

function labPoolMeta(db: Database.Database, pool: string): PoolMetaRow {
  const row = db
    .prepare(
      `SELECT p.base_is_token0, p.tick_spacing, p.fee,
              tb.decimals AS baseDecimals, tq.decimals AS quoteDecimals, tb.symbol AS baseSymbol
       FROM pools p
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       JOIN tokens tq ON tq.address = CASE WHEN p.base_is_token0 = 1 THEN p.token1 ELSE p.token0 END
       WHERE p.address = ? AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1`,
    )
    .get(pool.toLowerCase()) as PoolMetaRow | undefined
  if (!row) throw new Error('pool not tracked, unpriced, or unverified')
  return row
}

export interface LpBacktestParams {
  pool: string
  /** Range HALF-width in percent around the entry price (e.g. 30 = ±30%). */
  rangePct: number
  quoteWei: bigint
  fromBlock: number
  toBlock: number
}

export interface LpBacktestResult {
  baseSymbol: string
  tickLower: number
  tickUpper: number
  entryPrice: number
  exitPrice: number
  /** All values in human quote units (ETH). */
  deposit: number
  positionEndValue: number
  feesEarned: number
  endValueWithFees: number
  hodlValue: number
  impermanentLoss: number
  netVsHodl: number
  aprPct: number
  swapsReplayed: number
  feeEvents: number
  hours: number
}

export async function lpBacktest(
  client: ChainClient,
  db: Database.Database,
  p: LpBacktestParams,
): Promise<LpBacktestResult> {
  const meta = labPoolMeta(db, p.pool)
  const baseIsToken0 = meta.base_is_token0 === 1
  const spacing = meta.tick_spacing

  let liquidity = 0n
  let tickLower = 0
  let tickUpper = 0
  let sqrtLower = 0n
  let sqrtUpper = 0n
  let entryAmounts = { amount0: 0n, amount1: 0n }
  let entryPrice = 0
  let fees0 = 0n
  let fees1 = 0n
  let feeEvents = 0
  let finalState: import('@paperhands/engine').V3PoolState | undefined

  const extraLiquidity = { tickLower: 0, tickUpper: 0, amount: 0n }
  const stats = await replayPool(client, db, p.pool, p.fromBlock, p.toBlock, {
    trace: true,
    snapToRecorded: true,
    extraLiquidity,
    onStart(controls) {
      const s = controls.state
      // ±rangePct in price → ticks (price ratio r ↔ tick ln(r)/ln(1.0001))
      const tickSpan = Math.round(Math.log(1 + p.rangePct / 100) / Math.log(1.0001))
      tickLower = Math.floor((s.tick - tickSpan) / spacing) * spacing
      tickUpper = Math.ceil((s.tick + tickSpan) / spacing) * spacing
      if (tickUpper === tickLower) tickUpper += spacing
      sqrtLower = getSqrtRatioAtTick(tickLower)
      sqrtUpper = getSqrtRatioAtTick(tickUpper)

      const probe = 10n ** 18n
      const probeAmounts = getAmountsForLiquidity(s.sqrtPriceX96, sqrtLower, sqrtUpper, probe)
      const praw = (Number(s.sqrtPriceX96) / 2 ** 96) ** 2
      const quoteIsToken1 = baseIsToken0
      const valuePerProbe = quoteIsToken1
        ? Number(probeAmounts.amount1) + Number(probeAmounts.amount0) * praw
        : Number(probeAmounts.amount0) + Number(probeAmounts.amount1) / praw
      if (valuePerProbe <= 0) throw new Error('range holds no value at entry price')
      liquidity = BigInt(Math.floor((Number(p.quoteWei) / valuePerProbe) * 1e18))
      if (liquidity <= 0n) throw new Error('deposit too small for this range')
      entryAmounts = getAmountsForLiquidity(s.sqrtPriceX96, sqrtLower, sqrtUpper, liquidity)
      entryPrice = basePriceInQuote(s.sqrtPriceX96, baseIsToken0, meta.baseDecimals, meta.quoteDecimals)
      applyLiquidityDelta(s, tickLower, tickUpper, liquidity)
      extraLiquidity.tickLower = tickLower
      extraLiquidity.tickUpper = tickUpper
      extraLiquidity.amount = liquidity
      finalState = s // stable reference; replayPool mutates it in place
    },
    onSwap(row, sim) {
      if (!sim.steps) return
      const zeroForOne = BigInt(row.amount0) > 0n
      for (const step of sim.steps) {
        const lo = step.sqrtStartX96 < step.sqrtEndX96 ? step.sqrtStartX96 : step.sqrtEndX96
        const hi = step.sqrtStartX96 > step.sqrtEndX96 ? step.sqrtStartX96 : step.sqrtEndX96
        if (lo < sqrtLower || hi > sqrtUpper || step.liquidity <= 0n) continue
        const share = mulDiv(step.feeAmount, liquidity, step.liquidity)
        if (share > 0n) {
          feeEvents++
          if (zeroForOne) fees0 += share
          else fees1 += share
        }
      }
    },
  })

  // Value everything in quote at the replayed exit price — the price path that
  // includes our own position's effect, not the position-free recorded one.
  if (!finalState) throw new Error('replay produced no state')
  const exitSqrt = finalState.sqrtPriceX96
  const exitAmounts = getAmountsForLiquidity(exitSqrt, sqrtLower, sqrtUpper, liquidity)
  const exitPrice = basePriceInQuote(exitSqrt, baseIsToken0, meta.baseDecimals, meta.quoteDecimals)

  const valueInQuote = (amount0: bigint, amount1: bigint, price: number): number => {
    const base = baseIsToken0 ? amount0 : amount1
    const quote = baseIsToken0 ? amount1 : amount0
    return toHuman(quote, meta.quoteDecimals) + toHuman(base, meta.baseDecimals) * price
  }

  const deposit = toHuman(p.quoteWei, 18)
  const positionEndValue = valueInQuote(exitAmounts.amount0, exitAmounts.amount1, exitPrice)
  const feesEarned = valueInQuote(fees0, fees1, exitPrice)
  const hodlValue = valueInQuote(entryAmounts.amount0, entryAmounts.amount1, exitPrice)
  const hours = Math.max((stats.lastTs - stats.firstTs) / 3600, 1 / 60)
  const aprPct = deposit > 0 ? (feesEarned / deposit / hours) * 8760 * 100 : 0

  return {
    baseSymbol: meta.baseSymbol,
    tickLower,
    tickUpper,
    entryPrice,
    exitPrice,
    deposit,
    positionEndValue,
    feesEarned,
    endValueWithFees: positionEndValue + feesEarned,
    hodlValue,
    impermanentLoss: hodlValue - positionEndValue,
    netVsHodl: positionEndValue + feesEarned - hodlValue,
    aprPct,
    swapsReplayed: stats.swaps,
    feeEvents,
    hours,
  }
}

export interface WalletReplayPoolResult {
  pool: string
  baseSymbol: string
  mirroredBuys: number
  mirroredSells: number
  investedQuote: number
  returnedQuote: number
  pnlQuote: number
}

export interface WalletReplayResult {
  wallet: string
  sizeEth: number
  pools: WalletReplayPoolResult[]
  totalInvested: number
  totalReturned: number
  totalPnl: number
  hours: number
}

/**
 * Would tailing this wallet with YOUR size have worked? Mirrors its recorded
 * swaps through history: its buys trigger fixed-size buys, its sells exit the
 * mirrored position; leftovers exit at the end state.
 */
export async function walletReplay(
  client: ChainClient,
  db: Database.Database,
  wallet: string,
  sizeQuoteWei: bigint,
  fromBlock: number,
  toBlock: number,
  maxPools = 8,
): Promise<WalletReplayResult> {
  const w = wallet.toLowerCase()
  const pools = db
    .prepare(
      `SELECT s.pool AS pool, COUNT(*) AS n FROM swaps s
       JOIN pools p ON p.address = s.pool
       WHERE s.trader = ? AND s.block > ? AND s.block <= ?
         AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1
       GROUP BY s.pool ORDER BY n DESC LIMIT ?`,
    )
    .all(w, fromBlock, toBlock, maxPools) as { pool: string; n: number }[]

  const results: WalletReplayPoolResult[] = []
  let firstTs = 0
  let lastTs = 0

  for (const { pool } of pools) {
    const meta = labPoolMeta(db, pool)
    const baseIsToken0 = meta.base_is_token0 === 1
    let pos: Position = EMPTY_POSITION
    let invested = 0n
    let returned = 0n
    let buys = 0
    let sells = 0

    // A pool discovered mid-window has no state anchor before its first
    // recorded swap — clamp the replay start to it.
    const firstSwap = db
      .prepare('SELECT MIN(block) AS b FROM swaps WHERE pool = ?')
      .get(pool) as { b: number | null }
    if (!firstSwap.b) continue
    const poolFrom = Math.max(fromBlock, firstSwap.b)

    let stats
    try {
      stats = await replayPool(client, db, pool, poolFrom, toBlock, {
      snapToRecorded: true,
      onSwap(row, _sim, controls) {
        if (row.trader !== w) return
        const ethAmt = BigInt(baseIsToken0 ? row.amount1 : row.amount0)
        if (ethAmt > 0n) {
          // Their buy → our fixed-size buy on the replayed pool.
          const r = controls.virtualSwap(sizeQuoteWei, !baseIsToken0)
          if (r.amountOut > 0n && r.amountIn === sizeQuoteWei && !r.exhaustedWindow) {
            pos = applyBuy(pos, r.amountOut, r.amountIn)
            invested += r.amountIn
            buys++
          }
        } else if (pos.qty > 0n) {
          // Their sell → exit our whole mirrored position.
          const r = controls.virtualSwap(pos.qty, baseIsToken0)
          if (r.amountIn === pos.qty) {
            pos = applySell(pos, r.amountIn, r.amountOut)
            returned += r.amountOut
            sells++
          }
        }
      },
    })
    } catch {
      continue // one broken pool must not kill the whole replay
    }
    firstTs = firstTs === 0 ? stats.firstTs : Math.min(firstTs, stats.firstTs || firstTs)
    lastTs = Math.max(lastTs, stats.lastTs)

    // Whatever is still held exits at the end state — realizable, not marked.
    if (pos.qty > 0n) {
      const endState = await reconstructEnd(client, db, pool, toBlock)
      if (endState) {
        const { simulateV3ExactIn } = await import('@paperhands/engine')
        const r = simulateV3ExactIn(endState, pos.qty, baseIsToken0)
        returned += r.amountOut
      }
    }

    results.push({
      pool,
      baseSymbol: meta.baseSymbol,
      mirroredBuys: buys,
      mirroredSells: sells,
      investedQuote: toHuman(invested, 18),
      returnedQuote: toHuman(returned, 18),
      pnlQuote: toHuman(returned - invested, 18),
    })
  }

  const totalInvested = results.reduce((a, r) => a + r.investedQuote, 0)
  const totalReturned = results.reduce((a, r) => a + r.returnedQuote, 0)
  return {
    wallet: w,
    sizeEth: toHuman(sizeQuoteWei, 18),
    pools: results,
    totalInvested,
    totalReturned,
    totalPnl: totalReturned - totalInvested,
    hours: Math.max((lastTs - firstTs) / 3600, 0),
  }
}

async function reconstructEnd(client: ChainClient, db: Database.Database, pool: string, toBlock: number) {
  try {
    const { reconstructAt } = await import('./history.js')
    return await reconstructAt(client, db, pool, toBlock)
  } catch {
    return null
  }
}
