import { UNISWAP, nfpmAbi } from '@paperhands/chain'
import { encodeFunctionData, type Address } from 'viem'

/**
 * Real LP mint through NonfungiblePositionManager, non-custodial. The WETH
 * side is sent as native ETH (the manager wraps exactly what it needs and
 * refunds the rest); the token side is pulled via allowance.
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

export function buildMint(plan: MintPlanLike, recipient: Address, slippageBps = 100) {
  const a0 = BigInt(plan.amount0)
  const a1 = BigInt(plan.amount1)
  const min = (v: bigint) => (v * BigInt(10_000 - slippageBps)) / 10_000n
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
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
        deadline,
      },
    ],
  })
  const refund = encodeFunctionData({ abi: nfpmAbi, functionName: 'refundETH', args: [] })
  const value = plan.wethIs === 0 ? a0 : plan.wethIs === 1 ? a1 : 0n
  return { address: UNISWAP.positionManager, abi: nfpmAbi, functionName: 'multicall' as const, args: [[mint, refund]] as const, value }
}
