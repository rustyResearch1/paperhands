import type { TickData, V3PoolState } from '@paperhands/engine'
import type { Address } from 'viem'
import { erc20Abi, tickLensAbi, v3PoolAbi } from './abis.js'
import { UNISWAP } from './addresses.js'
import type { ChainClient } from './client.js'

export interface TokenMeta {
  address: Address
  symbol: string
  name: string
  decimals: number
}

export interface V3PoolSnapshot {
  address: Address
  token0: TokenMeta
  token1: TokenMeta
  state: V3PoolState
  blockNumber: bigint
}

const tokenMetaCache = new Map<string, TokenMeta>()

export async function readTokenMeta(client: ChainClient, address: Address): Promise<TokenMeta> {
  const cached = tokenMetaCache.get(address.toLowerCase())
  if (cached) return cached
  const c = { address, abi: erc20Abi } as const
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ ...c, functionName: 'symbol' }),
    client.readContract({ ...c, functionName: 'name' }),
    client.readContract({ ...c, functionName: 'decimals' }),
  ])
  const meta = { address, symbol, name, decimals }
  tokenMetaCache.set(address.toLowerCase(), meta)
  return meta
}

/**
 * Read everything the engine needs to simulate swaps in a v3 pool.
 *
 * Ticks come from TickLens over `wordRadius` bitmap words each side of the
 * current tick. One word covers 256 * tickSpacing ticks, so even a radius of
 * 5 words spans far more price range than any sane paper trade moves (the
 * public RPC rate-limits, so every word costs budget). The window is
 * recorded in the state so oversize swaps report exhaustion honestly.
 */
export async function readV3Pool(
  client: ChainClient,
  pool: Address,
  wordRadius = 5,
  atBlock?: bigint,
): Promise<V3PoolSnapshot> {
  const p = { address: pool, abi: v3PoolAbi } as const
  const blockNumber = atBlock ?? (await client.getBlockNumber())
  const [slot0, liquidity, fee, tickSpacing, token0Addr, token1Addr] = await Promise.all([
    client.readContract({ ...p, functionName: 'slot0', blockNumber }),
    client.readContract({ ...p, functionName: 'liquidity', blockNumber }),
    client.readContract({ ...p, functionName: 'fee', blockNumber }),
    client.readContract({ ...p, functionName: 'tickSpacing', blockNumber }),
    client.readContract({ ...p, functionName: 'token0' }),
    client.readContract({ ...p, functionName: 'token1' }),
  ])

  const [sqrtPriceX96, tick] = slot0
  const spacing = Number(tickSpacing)
  const compressed = Math.floor(tick / spacing)
  const currentWord = compressed >> 8

  const wordIndexes: number[] = []
  for (let w = currentWord - wordRadius; w <= currentWord + wordRadius; w++) wordIndexes.push(w)

  // A failed word read MUST fail the whole snapshot: silently dropping a word
  // while tickWindow still claims coverage would let the engine simulate
  // through missing liquidity and overstate fills with no flag.
  const wordResults = await Promise.all(
    wordIndexes.map(async (w) => {
      try {
        return await client.readContract({
          address: UNISWAP.v3TickLens,
          abi: tickLensAbi,
          functionName: 'getPopulatedTicksInWord',
          args: [pool, w],
          blockNumber,
        })
      } catch (err) {
        throw new Error(`TickLens word ${w} unreadable for ${pool}: ${(err as Error).message.split('\n')[0]}`)
      }
    }),
  )

  const ticks: TickData[] = wordResults
    .flat()
    .map((t) => ({ tick: Number(t.tick), liquidityNet: t.liquidityNet }))
    .sort((a, b) => a.tick - b.tick)

  const windowMin = (currentWord - wordRadius) * 256 * spacing
  const windowMax = ((currentWord + wordRadius + 1) * 256 - 1) * spacing

  const [token0, token1] = await Promise.all([
    readTokenMeta(client, token0Addr),
    readTokenMeta(client, token1Addr),
  ])

  return {
    address: pool,
    token0,
    token1,
    blockNumber,
    state: {
      sqrtPriceX96,
      tick,
      liquidity,
      feePips: Number(fee),
      tickSpacing: spacing,
      ticks,
      tickWindow: { min: windowMin, max: windowMax },
    },
  }
}
