import type { TickData, V3PoolState } from '@paperhands/engine'
import type { Address, Hex } from 'viem'
import { v4StateViewAbi } from './abis.js'
import { UNISWAP } from './addresses.js'
import type { ChainClient } from './client.js'

export interface V4PoolStateSnapshot {
  poolId: Hex
  state: V3PoolState
  blockNumber: bigint
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
  const [sqrtPriceX96, tick, , lpFee] = slot0

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
    state: {
      sqrtPriceX96,
      tick,
      liquidity,
      // Static-fee pools report their fee here; dynamic-fee (hooked) pools
      // are excluded from simulation by callers anyway.
      feePips: feePips || Number(lpFee),
      tickSpacing,
      ticks,
      tickWindow: {
        min: (currentWord - wordRadius) * 256 * tickSpacing,
        max: ((currentWord + wordRadius + 1) * 256 - 1) * tickSpacing,
      },
    },
  }
}
