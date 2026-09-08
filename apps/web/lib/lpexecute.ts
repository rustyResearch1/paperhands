import { UNISWAP, WETH, nfpmAbi } from '@paperhands/chain'
import { encodeFunctionData, zeroAddress, type Address } from 'viem'

/**
 * Real LP actions through NonfungiblePositionManager, non-custodial. The WETH
 * side is sent as native ETH (the manager wraps exactly what it needs and
 * refunds the rest); the token side is pulled via allowance. On the way out,
 * WETH is unwrapped back to ETH.
 */
export interface MintPlanLike {
  token0: string
  token1: string
  fee: number
  tickLower: number
  tickUpper: number
  amount0: string
  amount1: string
  wethIs: 0 | 1 | null
}

const MAX_UINT128 = (1n << 128n) - 1n
const deadlineIn = (s: number) => BigInt(Math.floor(Date.now() / 1000) + s)

/** Any Uniswap-v3-fork position manager (PancakeSwap v3 on BSC) with its wrapped native token. */
export interface LpVenue {
  positionManager: Address
  wrappedNative: Address
}
const RH_VENUE: LpVenue = { positionManager: UNISWAP.positionManager, wrappedNative: WETH }

export function buildMint(plan: MintPlanLike, recipient: Address, slippageBps = 100, venue: LpVenue = RH_VENUE) {
  const nfpm = { address: venue.positionManager, abi: nfpmAbi } as const
  const a0 = BigInt(plan.amount0)
  const a1 = BigInt(plan.amount1)
  const min = (v: bigint) => (v * BigInt(10_000 - slippageBps)) / 10_000n
  const mint = encodeFunctionData({
    abi: nfpmAbi,
    functionName: 'mint',
    args: [
      {
        token0: plan.token0 as Address,
        token1: plan.token1 as Address,
        fee: plan.fee,
        tickLower: plan.tickLower,
        tickUpper: plan.tickUpper,
        amount0Desired: a0,
        amount1Desired: a1,
        amount0Min: min(a0),
        amount1Min: min(a1),
        recipient,
        deadline: deadlineIn(600),
      },
    ],
  })
  const refund = encodeFunctionData({ abi: nfpmAbi, functionName: 'refundETH', args: [] })
  const value = plan.wethIs === 0 ? a0 : plan.wethIs === 1 ? a1 : 0n
  return { ...nfpm, functionName: 'multicall' as const, args: [[mint, refund]] as const, value }
}

export interface LpLike {
  tokenId: string
  token0: string
  token1: string
  liquidity: string
  amount0: string
  amount1: string
}

/**
 * collect() everything owed. For a WETH pair the manager collects to itself
 * (recipient 0 means "this contract"), then unwraps the WETH to ETH and
 * sweeps the other token to the owner in the same transaction.
 */
function collectCalls(p: LpLike, owner: Address, venue: LpVenue): `0x${string}`[] {
  const weth = venue.wrappedNative.toLowerCase()
  const t0 = p.token0.toLowerCase()
  const t1 = p.token1.toLowerCase()
  const hasWeth = t0 === weth || t1 === weth
  const id = BigInt(p.tokenId)
  if (!hasWeth) {
    return [encodeFunctionData({ abi: nfpmAbi, functionName: 'collect', args: [{ tokenId: id, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }] })]
  }
  const other = (t0 === weth ? t1 : t0) as Address
  return [
    encodeFunctionData({ abi: nfpmAbi, functionName: 'collect', args: [{ tokenId: id, recipient: zeroAddress, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }] }),
    encodeFunctionData({ abi: nfpmAbi, functionName: 'unwrapWETH9', args: [0n, owner] }),
    encodeFunctionData({ abi: nfpmAbi, functionName: 'sweepToken', args: [other, 0n, owner] }),
  ]
}

export function buildCollect(p: LpLike, owner: Address, venue: LpVenue = RH_VENUE) {
  const nfpm = { address: venue.positionManager, abi: nfpmAbi } as const
  return { ...nfpm, functionName: 'multicall' as const, args: [collectCalls(p, owner, venue)] as const, value: 0n }
}

/**
 * Close a position: pull all liquidity (with a slippage floor on both
 * amounts), collect principal + fees, unwrap, and burn the empty NFT.
 */
export function buildClose(p: LpLike, owner: Address, slippageBps = 100, venue: LpVenue = RH_VENUE) {
  const nfpm = { address: venue.positionManager, abi: nfpmAbi } as const
  const id = BigInt(p.tokenId)
  const liq = BigInt(p.liquidity)
  const min = (v: string) => (BigInt(v) * BigInt(10_000 - slippageBps)) / 10_000n
  const calls: `0x${string}`[] = []
  if (liq > 0n) {
    calls.push(
      encodeFunctionData({
        abi: nfpmAbi,
        functionName: 'decreaseLiquidity',
        args: [{ tokenId: id, liquidity: liq, amount0Min: min(p.amount0), amount1Min: min(p.amount1), deadline: deadlineIn(600) }],
      }),
    )
  }
  calls.push(...collectCalls(p, owner, venue))
  calls.push(encodeFunctionData({ abi: nfpmAbi, functionName: 'burn', args: [id] }))
  return { ...nfpm, functionName: 'multicall' as const, args: [calls] as const, value: 0n }
}
