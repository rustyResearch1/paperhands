import { readV3Pool, readV4Pool, type ChainClient } from '@paperhands/chain'
import type { V3PoolState } from '@paperhands/engine'
import type Database from 'better-sqlite3'
import type { Address, Hex } from 'viem'

export interface PoolStateSnapshot {
  state: V3PoolState
  blockNumber: bigint
  /** v4 only: effective (protocol + LP) fee per swap direction, in pips. */
  feeZeroForOne?: number
  feeOneForZero?: number
}

/** Engine state for a swap direction — v4 fees differ by direction. */
export function stateForDirection(snap: PoolStateSnapshot, zeroForOne: boolean): V3PoolState {
  const fee = zeroForOne ? snap.feeZeroForOne : snap.feeOneForZero
  return fee === undefined ? snap.state : { ...snap.state, feePips: fee }
}

/**
 * Version-dispatching pool state reader: v3 pools read via TickLens, v4
 * pools via StateView — both land in the same engine-ready shape. Quote
 * through stateForDirection so v4's per-direction protocol fee applies.
 */
export async function readPoolState(
  client: ChainClient,
  db: Database.Database,
  pool: string,
  opts: { wordRadius?: number; atBlock?: bigint } = {},
): Promise<PoolStateSnapshot> {
  const row = db
    .prepare('SELECT version, fee, tick_spacing, hooks FROM pools WHERE address = ?')
    .get(pool.toLowerCase()) as { version: number; fee: number; tick_spacing: number; hooks: string | null } | undefined
  if (!row) throw new Error(`unknown pool ${pool}`)
  if (row.version === 4) {
    const snap = await readV4Pool(
      client,
      pool as Hex,
      row.fee,
      row.tick_spacing,
      opts.wordRadius ?? 5,
      opts.atBlock,
    )
    return {
      state: snap.state,
      blockNumber: snap.blockNumber,
      feeZeroForOne: snap.feeZeroForOne,
      feeOneForZero: snap.feeOneForZero,
    }
  }
  const snap = await readV3Pool(client, pool as Address, opts.wordRadius ?? 5, opts.atBlock)
  return { state: snap.state, blockNumber: snap.blockNumber }
}
