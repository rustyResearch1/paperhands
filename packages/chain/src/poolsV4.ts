import type { TickData, V3PoolState } from '@paperhands/engine'
import type { Address, Hex } from 'viem'
import { v4StateViewAbi } from './abis.js'
import { UNISWAP } from './addresses.js'
import type { ChainClient } from './client.js'

export interface V4PoolStateSnapshot {
  poolId: Hex
  state: V3PoolState
  blockNumber: bigint
  /** Effective swap fee (protocol + LP, v4 combination formula) per direction, in pips. */
  feeZeroForOne: number
  feeOneForZero: number
}

/**
 * v4 charges the protocol fee on input ahead of the LP fee:
 * swapFee = protocol + lp − protocol·lp/1e6 (floor), per direction.
 */
export function v4EffectiveFee(protocolFeeDir: number, lpFee: number): number {
  return protocolFeeDir + lpFee - Math.floor((protocolFeeDir * lpFee) / 1_000_000)
}

/** The engine state for one swap direction (fee differs by direction in v4). */
export function v4StateForDirection(snap: V4PoolStateSnapshot, zeroForOne: boolean): V3PoolState {
  return { ...snap.state, feePips: zeroForOne ? snap.feeZeroForOne : snap.feeOneForZero }
}

/**
 * Read a v4 pool's state through StateView. v4's core math is identical to
 * v3, so the result feeds the same engine — the difference is plumbing:
 * pools live in the singleton PoolManager keyed by id, and initialized
 * ticks come from tickBitmap words + per-tick liquidity reads.
 *
 * Only meaningful for hookless pools — hooks can rewrite fills arbitrarily,
 * so callers must gate simulation on hooks == address(0).
 */
export async function readV4Pool(
  client: ChainClient,
  poolId: Hex,
  feePips: number,
  tickSpacing: number,
  wordRadius = 5,
  atBlock?: bigint,
): Promise<V4PoolStateSnapshot> {
  const sv = { address: UNISWAP.v4StateView as Address, abi: v4StateViewAbi } as const
  const blockNumber = atBlock ?? (await client.getBlockNumber())

  const [slot0, liquidity] = await Promise.all([
    client.readContract({ ...sv, functionName: 'getSlot0', args: [poolId], blockNumber }),
    client.readContract({ ...sv, functionName: 'getLiquidity', args: [poolId], blockNumber }),
  ])
  const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0
  // Per-direction protocol fee: lower 12 bits = zeroForOne, upper = oneForZero.
  const pfZeroForOne = Number(protocolFee) & 0xfff
  const pfOneForZero = Number(protocolFee) >> 12
  const lp = feePips || Number(lpFee)

  const compressed = Math.floor(tick / tickSpacing)
  const currentWord = compressed >> 8
  const words: number[] = []
  for (let w = currentWord - wordRadius; w <= currentWord + wordRadius; w++) words.push(w)

  const bitmaps = await Promise.all(
    words.map((w) =>
      client.readContract({ ...sv, functionName: 'getTickBitmap', args: [poolId, w], blockNumber }),
    ),
  )

  const initializedTicks: number[] = []
  bitmaps.forEach((bitmap, i) => {
    if (bitmap === 0n) return
    const word = words[i]!
    for (let bit = 0; bit < 256; bit++) {
      if ((bitmap >> BigInt(bit)) & 1n) {
        initializedTicks.push((word * 256 + bit) * tickSpacing)
      }
    }
  })

  // Per-tick liquidity reads, politely chunked for the public RPC.
  const ticks: TickData[] = []
  for (let i = 0; i < initializedTicks.length; i += 16) {
    const chunk = initializedTicks.slice(i, i + 16)
    const infos = await Promise.all(
      chunk.map((t) =>
        client.readContract({ ...sv, functionName: 'getTickLiquidity', args: [poolId, t], blockNumber }),
      ),
    )
    infos.forEach(([, liquidityNet], j) => {
      ticks.push({ tick: chunk[j]!, liquidityNet })
    })
  }
  ticks.sort((a, b) => a.tick - b.tick)

  return {
    poolId,
    blockNumber,
    feeZeroForOne: v4EffectiveFee(pfZeroForOne, lp),
    feeOneForZero: v4EffectiveFee(pfOneForZero, lp),
    state: {
      sqrtPriceX96,
      tick,
      liquidity,
      // LP-only fee; quote through v4StateForDirection so the direction's
      // protocol fee is included — quoting with this raw state overstates output.
      feePips: lp,
      tickSpacing,
      ticks,
      tickWindow: {
        min: (currentWord - wordRadius) * 256 * tickSpacing,
        max: ((currentWord + wordRadius + 1) * 256 - 1) * tickSpacing,
      },
    },
  }
}
