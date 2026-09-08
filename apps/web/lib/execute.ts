import { NATIVE, UNISWAP, WETH, swapRouter02Abi, universalRouterAbi } from '@paperhands/chain'
import { encodeAbiParameters, encodeFunctionData, encodePacked, type Address, type Hex } from 'viem'

/**
 * Turn a quoted route into the exact transaction the wallet signs. Non-custodial:
 * the router pulls tokens from the user (or takes sent ETH), swaps, and
 * delivers straight to the user. Our exact quote sets amountOutMinimum.
 *
 * Hookless v3 routes sign through SwapRouter02. v4 routes (hooked or not)
 * sign through the Universal Router, which speaks the PoolManager's
 * action language and pulls ERC20 input via Permit2.
 */
export interface ExecLeg {
  version: number
  pool: string
  tokenIn: string
  tokenOut: string
  fee: number
  tickSpacing?: number
  hooks?: string
}

export interface V3SwapTx {
  router: 'v3'
  address: Address
  abi: typeof swapRouter02Abi
  functionName: 'multicall'
  args: readonly [readonly Hex[]]
  value: bigint
}
export interface V4SwapTx {
  router: 'v4'
  address: Address
  abi: typeof universalRouterAbi
  functionName: 'execute'
  args: readonly [Hex, readonly Hex[], bigint]
  value: bigint
}
export type SwapTx = V3SwapTx | V4SwapTx

/** Which signer path a route needs; null when no single transaction can sign it. */
export function routerFor(legs: ExecLeg[]): 'v3' | 'v4' | null {
  if (legs.length === 0) return null
  if (legs.every((l) => l.version === 3)) return 'v3'
  if (legs.every((l) => l.version === 4)) return 'v4'
  return null
}

export function buildRouteSwap(opts: { side: 'buy' | 'sell'; legs: ExecLeg[]; amountIn: bigint; minOut: bigint; recipient: Address }): SwapTx {
  const r = routerFor(opts.legs)
  if (r === 'v3') return buildSwap(opts)
  if (r === 'v4') return buildV4Swap(opts)
  throw new Error('route mixes v3 and v4 legs — not signable in one transaction')
}

// ---------------------------------------------------------------------------
// v3 · SwapRouter02

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

export function buildSwap(opts: { side: 'buy' | 'sell'; legs: ExecLeg[]; amountIn: bigint; minOut: bigint; recipient: Address }): V3SwapTx {
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

  const calls: Hex[] = [swapData]
  if (innerRecipient === ADDRESS_THIS) calls.push(encodeFunctionData({ abi: swapRouter02Abi, functionName: 'unwrapWETH9', args: [minOut, recipient] }))
  return { router: 'v3', address: UNISWAP.swapRouter02, abi: swapRouter02Abi, functionName: 'multicall', args: [calls], value }
}

// ---------------------------------------------------------------------------
// v4 · Universal Router

/** UR command byte for a v4 action bundle. */
const CMD_V4_SWAP = 0x10
/** v4-periphery Actions. */
const ACT_SWAP_EXACT_IN_SINGLE = 0x06
const ACT_SWAP_EXACT_IN = 0x07
const ACT_SETTLE_ALL = 0x0c
const ACT_TAKE_ALL = 0x0f

const POOL_KEY = {
  type: 'tuple',
  name: 'poolKey',
  components: [
    { type: 'address', name: 'currency0' },
    { type: 'address', name: 'currency1' },
    { type: 'uint24', name: 'fee' },
    { type: 'int24', name: 'tickSpacing' },
    { type: 'address', name: 'hooks' },
  ],
} as const

const EXACT_IN_SINGLE_PARAMS = [
  {
    type: 'tuple',
    name: 'params',
    components: [
      POOL_KEY,
      { type: 'bool', name: 'zeroForOne' },
      { type: 'uint128', name: 'amountIn' },
      { type: 'uint128', name: 'amountOutMinimum' },
      { type: 'bytes', name: 'hookData' },
    ],
  },
] as const

const EXACT_IN_PARAMS = [
  {
    type: 'tuple',
    name: 'params',
    components: [
      { type: 'address', name: 'currencyIn' },
      {
        type: 'tuple[]',
        name: 'path',
        components: [
          { type: 'address', name: 'intermediateCurrency' },
          { type: 'uint24', name: 'fee' },
          { type: 'int24', name: 'tickSpacing' },
          { type: 'address', name: 'hooks' },
          { type: 'bytes', name: 'hookData' },
        ],
      },
      { type: 'uint128', name: 'amountIn' },
      { type: 'uint128', name: 'amountOutMinimum' },
    ],
  },
] as const

const CURRENCY_AMOUNT = [
  { type: 'address', name: 'currency' },
  { type: 'uint256', name: 'amount' },
] as const

const lower = (a: string) => BigInt(a)

export function buildV4Swap(opts: { legs: ExecLeg[]; amountIn: bigint; minOut: bigint; recipient: Address; deadlineSeconds?: number }): V4SwapTx {
  const { legs, amountIn, minOut } = opts
  if (legs.length === 0 || legs.some((l) => l.version !== 4)) throw new Error('route is not executable via the Universal Router')
  for (const l of legs) if (l.tickSpacing === undefined || l.hooks === undefined) throw new Error('v4 leg is missing its pool key')
  const currencyIn = legs[0]!.tokenIn as Address
  const currencyOut = legs[legs.length - 1]!.tokenOut as Address

  let swapAction: number
  let swapParams: Hex
  if (legs.length === 1) {
    const l = legs[0]!
    const zeroForOne = lower(l.tokenIn) < lower(l.tokenOut)
    const poolKey = {
      currency0: (zeroForOne ? l.tokenIn : l.tokenOut) as Address,
      currency1: (zeroForOne ? l.tokenOut : l.tokenIn) as Address,
      fee: l.fee,
      tickSpacing: l.tickSpacing!,
      hooks: l.hooks as Address,
    }
    swapAction = ACT_SWAP_EXACT_IN_SINGLE
    swapParams = encodeAbiParameters(EXACT_IN_SINGLE_PARAMS, [{ poolKey, zeroForOne, amountIn, amountOutMinimum: minOut, hookData: '0x' }])
  } else {
    swapAction = ACT_SWAP_EXACT_IN
    swapParams = encodeAbiParameters(EXACT_IN_PARAMS, [
      {
        currencyIn,
        path: legs.map((l) => ({
          intermediateCurrency: l.tokenOut as Address,
          fee: l.fee,
          tickSpacing: l.tickSpacing!,
          hooks: l.hooks as Address,
          hookData: '0x' as Hex,
        })),
        amountIn,
        amountOutMinimum: minOut,
      },
    ])
  }

  const actions = encodePacked(['uint8', 'uint8', 'uint8'], [swapAction, ACT_SETTLE_ALL, ACT_TAKE_ALL])
  const params: Hex[] = [
    swapParams,
    encodeAbiParameters(CURRENCY_AMOUNT, [currencyIn, amountIn]),
    encodeAbiParameters(CURRENCY_AMOUNT, [currencyOut, minOut]),
  ]
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, params])
  const commands = encodePacked(['uint8'], [CMD_V4_SWAP])
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (opts.deadlineSeconds ?? 600))
  // Native ETH in rides along as msg.value; ERC20 in is pulled via Permit2.
  const value = currencyIn.toLowerCase() === NATIVE ? amountIn : 0n
  return { router: 'v4', address: UNISWAP.universalRouter, abi: universalRouterAbi, functionName: 'execute', args: [commands, [input], deadline], value }
}

/** Slippage guard from an exact quote: minOut = quoted × (1 − bps/10000). */
export function minOutFrom(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n
}

export const MAX_UINT160 = (1n << 160n) - 1n
/** Permit2 allowance lifetime we ask for: 30 days, like the Uniswap app. */
export const PERMIT2_EXPIRY_SECONDS = 30 * 86_400
