/**
 * Live proof of engine soundness: quote real sizes through the real
 * JUGGERNAUT/WETH pools with our local tick-walk simulator, then ask the
 * chain's own QuoterV2 the same question at the same block. The two must
 * agree wei-for-wei on amountOut and land on the same sqrtPriceX96.
 *
 *   pnpm --filter @paperhands/chain validate
 */
import { quoteV3ExactIn } from '@paperhands/engine'
import { formatUnits, parseEther } from 'viem'
import { quoterV2Abi } from './abis.js'
import { FIXTURE_POOLS, KNOWN_TOKENS, UNISWAP } from './addresses.js'
import { makeClient } from './client.js'
import { readV3Pool } from './pools.js'

const client = makeClient()

const SIZES_ETH = ['0.01', '0.1', '1', '10'] as const

async function validatePool(poolAddr: `0x${string}`) {
  const snap = await readV3Pool(client, poolAddr)
  const { token0, token1, state } = snap
  const jugIsToken0 = token0.address.toLowerCase() === KNOWN_TOKENS.JUGGERNAUT!.toLowerCase()
  const weth = jugIsToken0 ? token1 : token0
  const jug = jugIsToken0 ? token0 : token1

  console.log(`\npool ${poolAddr} (fee ${state.feePips / 10000}%)`)
  console.log(`  ${token0.symbol}/${token1.symbol}  tick=${state.tick}  liquidity=${state.liquidity}  ticks known=${state.ticks.length}  block=${snap.blockNumber}`)

  if (state.liquidity === 0n && state.ticks.length === 0) {
    console.log('  empty pool (no liquidity anywhere) — skipped')
    return { pass: 0, fail: 0, skipped: true }
  }

  let pass = 0
  let fail = 0
  for (const size of SIZES_ETH) {
    const amountIn = parseEther(size)
    // Buying JUGGERNAUT with WETH: input is WETH.
    const zeroForOne = !jugIsToken0

    const local = quoteV3ExactIn(state, amountIn, zeroForOne)

    let remote
    try {
      remote = await client.simulateContract({
        address: UNISWAP.v3Quoter,
        abi: quoterV2Abi,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn: weth.address,
            tokenOut: jug.address,
            amountIn,
            fee: state.feePips,
            sqrtPriceLimitX96: 0n,
          },
        ],
        blockNumber: snap.blockNumber,
      })
    } catch (err) {
      // A quoter revert only contradicts us if we claimed the swap fills.
      const contradicted = local.amountOut > 0n
      console.log(
        `  ${size.padStart(5)} ETH  quoter reverted (local amountOut=${local.amountOut}) ${contradicted ? '✗' : '— consistent'}`,
      )
      contradicted ? fail++ : pass++
      continue
    }

    const [amountOut, sqrtAfter, ticksCrossed] = remote.result
    const outMatch = local.amountOut === amountOut
    const priceMatch = local.sqrtPriceX96After === sqrtAfter
    const ok = outMatch && priceMatch
    ok ? pass++ : fail++

    console.log(
      `  ${size.padStart(5)} ETH → ${formatUnits(amountOut, jug.decimals).slice(0, 12)} ${jug.symbol}` +
        `  | local=${local.amountOut} chain=${amountOut} ${outMatch ? '✓' : '✗ MISMATCH'}` +
        `  | sqrtPrice ${priceMatch ? '✓' : '✗'}  ticksCrossed local=${local.ticksCrossed} chain=${ticksCrossed}` +
        `  | impact=${local.priceImpactBps.toFixed(1)}bps fill=${(local.fillRatio * 100).toFixed(1)}%`,
    )
  }
  return { pass, fail, skipped: false }
}

const results = { pass: 0, fail: 0 }
for (const pool of Object.values(FIXTURE_POOLS)) {
  const r = await validatePool(pool)
  results.pass += r.pass
  results.fail += r.fail
}

console.log(`\n${results.pass} exact matches, ${results.fail} mismatches`)
if (results.fail > 0) process.exit(1)
console.log('engine is wei-for-wei consistent with on-chain QuoterV2')
