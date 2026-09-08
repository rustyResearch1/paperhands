import { UNISWAP, WETH, swapRouter02Abi } from '@paperhands/chain'
import { encodeFunctionData, encodePacked, type Address, type Hex } from 'viem'

/**
 * Turn a quoted route into the exact transaction the wallet signs. Non-custodial:
 * SwapRouter02 pulls tokens from the user (or wraps sent ETH), swaps, and
 * delivers straight to the user. Our exact quote sets amountOutMinimum.
 */
export interface ExecLeg {
  version: number
  pool: string
  tokenIn: string
  tokenOut: string
  fee: number
}

export interface SwapTx {
  address: Address
  abi: typeof swapRouter02Abi
  functionName: 'exactInputSingle' | 'exactInput' | 'multicall'
  args: readonly unknown[]
  value: bigint
}

/** Router-internal recipient sentinel: hold output in the router for a follow-up unwrap. */
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002' as Address

function path(legs: ExecLeg[]): Hex {
  const types: ('address' | 'uint24')[] = []
  const values: (Address | number)[] = []
  legs.forEach((l, i) => {
    if (i === 0) {
      types.push('address')
      values.push(l.tokenIn as Address)
    }
    types.push('uint24', 'address')
    values.push(l.fee, l.tokenOut as Address)
  })
  return encodePacked(types, values)
}

export function buildSwap(opts: {
  side: 'buy' | 'sell'
  legs: ExecLeg[]
  amountIn: bigint
  minOut: bigint
  recipient: Address
}): SwapTx {
  const { side, legs, amountIn, minOut, recipient } = opts
  if (legs.length === 0 || legs.some((l) => l.version !== 3)) throw new Error('route is not executable via SwapRouter02')
  const weth = WETH.toLowerCase()
  const inIsWeth = legs[0]!.tokenIn.toLowerCase() === weth
  const outIsWeth = legs[legs.length - 1]!.tokenOut.toLowerCase() === weth

  // Buys send native ETH; the router wraps it. Sells deliver WETH into the
  // router, then unwrap to the user in the same transaction.
  const value = side === 'buy' && inIsWeth ? amountIn : 0n
  const innerRecipient = side === 'sell' && outIsWeth ? ADDRESS_THIS : recipient

  const swapData =
    legs.length === 1
      ? encodeFunctionData({
          abi: swapRouter02Abi,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: legs[0]!.tokenIn as Address,
              tokenOut: legs[0]!.tokenOut as Address,
              fee: legs[0]!.fee,
              recipient: innerRecipient,
              amountIn,
              amountOutMinimum: minOut,
              sqrtPriceLimitX96: 0n,
            },
          ],
        })
      : encodeFunctionData({
          abi: swapRouter02Abi,
          functionName: 'exactInput',
          args: [{ path: path(legs), recipient: innerRecipient, amountIn, amountOutMinimum: minOut }],
        })

  if (innerRecipient === ADDRESS_THIS) {
    const unwrap = encodeFunctionData({ abi: swapRouter02Abi, functionName: 'unwrapWETH9', args: [minOut, recipient] })
    return { address: UNISWAP.swapRouter02, abi: swapRouter02Abi, functionName: 'multicall', args: [[swapData, unwrap]], value }
  }
  return {
    address: UNISWAP.swapRouter02,
    abi: swapRouter02Abi,
    functionName: 'multicall',
    args: [[swapData]],
    value,
  }
}

/** Slippage guard from an exact quote: minOut = quoted × (1 − bps/10000). */
export function minOutFrom(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n
}
