import type { ChainClient } from '@paperhands/chain'
import { readPoolState } from './readers.js'
import {
  getAmountsForLiquidity,
  getSqrtRatioAtTick,
  simulateV3ExactIn,
  type SwapResult,
  type TickData,
  type V3PoolState,
} from '@paperhands/engine'
import type Database from 'better-sqlite3'
import type { Address } from 'viem'
import { getMeta } from './db.js'

/**
 * Historical pool-state reconstruction and event-sourced replay.
 *
 * The chain is the ledger: we hold every Swap and every Mint/Burn since
 * `liq_from`. State at block B is recovered by taking a live TickLens
 * snapshot pinned at the indexer cursor and REVERSE-applying all liquidity
 * deltas after B; price/tick/in-range-L come from the last recorded swap at
 * or before B. Replays then re-execute recorded swap inputs through the
 * engine — which self-validates, because simulated outputs must reproduce
 * what actually happened on-chain.
 */

export interface SwapEventRow {
  tx_hash: string
  log_index: number
  block: number
  ts: number
  amount0: string
  amount1: string
  sqrt_price_x96: string
  tick: number
  liquidity: string | null
  trader: string | null
}

interface LiqRow {
  block: number
  log_index: number
  kind: number
  tick_lower: number
  tick_upper: number
  amount: string
}

export function liqFromBlock(db: Database.Database): number | undefined {
  const v = getMeta(db, 'liq_from')
  return v ? Number(v) : undefined
}

/** Mutate a replay state with a liquidity delta (sorted-insert into ticks). */
export function applyLiquidityDelta(
  state: V3PoolState,
  tickLower: number,
  tickUpper: number,
  delta: bigint,
): void {
  // A bound outside the snapshot's tick window must NOT create an entry or
  // widen the window: the region beyond it holds unknown other ticks, and a
  // lone "known" tick there lets the walker cross half a tick set — the
  // window boundary is the honest edge of knowledge.
  const win = state.tickWindow
  if (!win || (tickLower >= win.min && tickLower <= win.max)) upsertTickNet(state.ticks, tickLower, delta)
  if (!win || (tickUpper >= win.min && tickUpper <= win.max)) upsertTickNet(state.ticks, tickUpper, -delta)
  if (tickLower <= state.tick && state.tick < tickUpper) {
    state.liquidity += delta
    if (state.liquidity < 0n) throw new Error('replay: in-range liquidity went negative')
  }
}

function upsertTickNet(ticks: TickData[], tick: number, delta: bigint): void {
  let lo = 0
  let hi = ticks.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ticks[mid]!.tick === tick) {
      ticks[mid]!.liquidityNet += delta
      return
    }
    if (ticks[mid]!.tick < tick) lo = mid + 1
    else hi = mid - 1
  }
  ticks.splice(lo, 0, { tick, liquidityNet: delta })
}

/** State after block `atBlock` completed. Requires liq backfill coverage. */
export async function reconstructAt(
  client: ChainClient,
  db: Database.Database,
  pool: string,
  atBlock: number,
): Promise<V3PoolState> {
  const poolKey = pool.toLowerCase()
  const from = liqFromBlock(db)
  if (from === undefined) throw new Error('liq events not backfilled — run: main.ts liq-backfill')
  if (atBlock < from) throw new Error(`history starts at block ${from}; asked for ${atBlock}`)
  const cursorStr = getMeta(db, 'watch_cursor')
  if (!cursorStr) throw new Error('no watch cursor')
  const cursor = Number(cursorStr)
  if (atBlock > cursor) throw new Error(`cursor at ${cursor}; asked for future block ${atBlock}`)

  // The snapshot must be pinned to the cursor so liq_events coverage aligns,
  // and full nodes only serve recent state — a lagging watch loop breaks both.
  const head = Number(await client.getBlockNumber())
  if (head - cursor > 2000) {
    throw new Error(
      `indexer cursor lags the chain head by ${head - cursor} blocks — start the watch loop and let it catch up`,
    )
  }
  const snap = await readPoolState(client, db, poolKey, { wordRadius: 12, atBlock: BigInt(cursor) })
  const state: V3PoolState = {
    ...snap.state,
    ticks: snap.state.ticks.map((t) => ({ ...t })),
  }
  if (snap.state.tickWindow) state.tickWindow = { ...snap.state.tickWindow }

  // Reverse every liquidity delta that happened after atBlock (order-free:
  // additive). Bounds outside the snapshot window are skipped — the window
  // stays the honest edge of knowledge (see applyLiquidityDelta).
  const win = state.tickWindow
  // Upper-bounded at the pinned cursor: the live watcher keeps inserting
  // events beyond it while our snapshot RPC runs, and reverse-applying
  // those would patch changes the snapshot never contained.
  const later = db
    .prepare(
      'SELECT block, log_index, kind, tick_lower, tick_upper, amount FROM liq_events WHERE pool = ? AND block > ? AND block <= ?',
    )
    .all(poolKey, atBlock, cursor) as LiqRow[]
  for (const e of later) {
    const delta = BigInt(e.kind) * BigInt(e.amount)
    if (!win || (e.tick_lower >= win.min && e.tick_lower <= win.max)) upsertTickNet(state.ticks, e.tick_lower, -delta)
    if (!win || (e.tick_upper >= win.min && e.tick_upper <= win.max)) upsertTickNet(state.ticks, e.tick_upper, delta)
  }

  // Price/tick/in-range L anchor on the last recorded swap at or before atBlock.
  const lastSwap = db
    .prepare(
      'SELECT block, log_index, sqrt_price_x96, tick, liquidity FROM swaps WHERE pool = ? AND block <= ? ORDER BY block DESC, log_index DESC LIMIT 1',
    )
    .get(poolKey, atBlock) as
    | { block: number; log_index: number; sqrt_price_x96: string; tick: number; liquidity: string | null }
    | undefined
  if (!lastSwap) throw new Error(`no swap history for ${poolKey} at or before block ${atBlock}`)
  if (lastSwap.liquidity === null) {
    throw new Error('swap rows missing liquidity — run: main.ts liq-backfill')
  }

  state.sqrtPriceX96 = BigInt(lastSwap.sqrt_price_x96)
  state.tick = lastSwap.tick
  let L = BigInt(lastSwap.liquidity)
  // Liquidity deltas landing after that swap but within atBlock shift in-range
  // L when they straddle the (unchanged-since) current tick.
  const between = db
    .prepare(
      `SELECT block, log_index, kind, tick_lower, tick_upper, amount FROM liq_events
       WHERE pool = ? AND block <= ? AND (block > ? OR (block = ? AND log_index > ?))`,
    )
    .all(poolKey, atBlock, lastSwap.block, lastSwap.block, lastSwap.log_index) as LiqRow[]
  for (const e of between) {
    if (e.tick_lower <= state.tick && state.tick < e.tick_upper) {
      L += BigInt(e.kind) * BigInt(e.amount)
    }
  }
  if (L < 0n) throw new Error('replay: reconstructed liquidity negative — missing liq events?')
  state.liquidity = L
  return state
}

export interface ReplayControls {
  /** Current mutable state — read for marks, do not replace. */
  state: V3PoolState
  /** Execute a virtual (paper) swap against the replayed pool, mutating it. */
  virtualSwap(amountIn: bigint, zeroForOne: boolean): SwapResult
}

export interface ReplayHandlers {
  /** Called once with the reconstructed start state, before any event. */
  onStart?(controls: ReplayControls): void
  /** Called after each recorded swap has been simulated and applied. */
  onSwap?(row: SwapEventRow, sim: SwapResult, controls: ReplayControls): void
  /** Simulate with per-step trace (needed for LP fee attribution). */
  trace?: boolean
  /**
   * After each recorded swap, re-anchor state to the recorded post-swap
   * price/tick/liquidity. Bounds counterfactual drift to within one swap —
   * without it, virtual orders shift the price path and recorded liquidity
   * events eventually apply against inconsistent state.
   */
  snapToRecorded?: boolean
  /** A virtual position whose liquidity rides on top of recorded state when snapping. */
  extraLiquidity?: { tickLower: number; tickUpper: number; amount: bigint }
}

export interface ReplayStats {
  swaps: number
  liqEvents: number
  exactOut: number
  exactPrice: number
  firstTs: number
  lastTs: number
}

/** Replay all recorded events of a pool through the engine over (fromBlock, toBlock]. */
export async function replayPool(
  client: ChainClient,
  db: Database.Database,
  pool: string,
  fromBlock: number,
  toBlock: number,
  handlers: ReplayHandlers = {},
): Promise<ReplayStats> {
  const poolKey = pool.toLowerCase()
  const state = await reconstructAt(client, db, poolKey, fromBlock)

  const swaps = db
    .prepare(
      `SELECT tx_hash, log_index, block, ts, amount0, amount1, sqrt_price_x96, tick, liquidity, trader
       FROM swaps WHERE pool = ? AND block > ? AND block <= ? ORDER BY block ASC, log_index ASC`,
    )
    .all(poolKey, fromBlock, toBlock) as SwapEventRow[]
  const liq = db
    .prepare(
      `SELECT block, log_index, kind, tick_lower, tick_upper, amount
       FROM liq_events WHERE pool = ? AND block > ? AND block <= ? ORDER BY block ASC, log_index ASC`,
    )
    .all(poolKey, fromBlock, toBlock) as LiqRow[]

  const controls: ReplayControls = {
    state,
    virtualSwap(amountIn, zeroForOne) {
      const r = simulateV3ExactIn(state, amountIn, zeroForOne, { trace: handlers.trace ?? false })
      state.sqrtPriceX96 = r.sqrtPriceX96After
      state.tick = r.tickAfter
      state.liquidity = r.liquidityAfter
      return r
    },
  }

  const stats: ReplayStats = { swaps: 0, liqEvents: 0, exactOut: 0, exactPrice: 0, firstTs: 0, lastTs: 0 }
  handlers.onStart?.(controls)
  let si = 0
  let li = 0
  while (si < swaps.length || li < liq.length) {
    const s = swaps[si]
    const l = liq[li]
    const liqFirst =
      l !== undefined && (s === undefined || l.block < s.block || (l.block === s.block && l.log_index < s.log_index))
    if (liqFirst && l) {
      applyLiquidityDelta(state, l.tick_lower, l.tick_upper, BigInt(l.kind) * BigInt(l.amount))
      stats.liqEvents++
      li++
      continue
    }
    if (!s) break
    const a0 = BigInt(s.amount0)
    const a1 = BigInt(s.amount1)
    const zeroForOne = a0 > 0n
    const input = zeroForOne ? a0 : a1
    const recordedOut = zeroForOne ? -a1 : -a0

    let sim: SwapResult
    try {
      sim = simulateV3ExactIn(state, input, zeroForOne, { trace: handlers.trace ?? false })
    } catch (err) {
      const near = state.ticks.filter((t) => Math.abs(t.tick - state.tick) < 60).map((t) => `${t.tick}:${t.liquidityNet}`)
      throw new Error(
        `${(err as Error).message} @ swap block=${s.block} tx=${s.tx_hash} tick=${state.tick} L=${state.liquidity} in=${input} z41=${zeroForOne} nearTicks=[${near.join(' ')}]`,
      )
    }
    state.sqrtPriceX96 = sim.sqrtPriceX96After
    state.tick = sim.tickAfter
    state.liquidity = sim.liquidityAfter

    stats.swaps++
    if (stats.firstTs === 0) stats.firstTs = s.ts
    stats.lastTs = s.ts
    if (sim.amountOut === recordedOut) stats.exactOut++
    if (sim.sqrtPriceX96After === BigInt(s.sqrt_price_x96)) stats.exactPrice++

    if (handlers.snapToRecorded) {
      state.sqrtPriceX96 = BigInt(s.sqrt_price_x96)
      state.tick = s.tick
      if (s.liquidity !== null) {
        let L = BigInt(s.liquidity)
        const extra = handlers.extraLiquidity
        if (extra && extra.tickLower <= s.tick && s.tick < extra.tickUpper) L += extra.amount
        state.liquidity = L
      }
    }

    handlers.onSwap?.(s, sim, controls)
    si++
  }
  return stats
}
