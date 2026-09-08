/**
 * Simulate the exact transaction a wallet would sign for a real trade, without
 * a wallet: quote through the running web app (real=1), build the calldata
 * with lib/execute, then eth_call + eth_estimateGas it against live chain state
 * from an ETH-rich address (the WETH contract).
 *
 *   pnpm exec tsx scripts/sim-real-swap.mts [pool] [buy|sell] [amountRaw]
 *
 * With no pool, picks the busiest hookless and hooked v4 native-ETH pools.
 * Sells are simulated from the WETH contract too, so they only prove encoding
 * up to the Permit2 pull (expect a Permit2/allowance revert, not a decode error).
 */
import Database from 'better-sqlite3'
import { encodeFunctionData } from 'viem'
import { WETH } from '@paperhands/chain'
import { buildRouteSwap, minOutFrom } from '../lib/execute'

const DB = new URL('../../../data/paperhands.sqlite', import.meta.url).pathname
const WEB = process.env.PAPERHANDS_WEB ?? 'http://localhost:3000'
const RPC = process.env.PAPERHANDS_RPC ?? 'https://rpc.mainnet.chain.robinhood.com'
const ZERO = '0x0000000000000000000000000000000000000000'

const [argPool, argSide = 'buy', argAmount] = process.argv.slice(2)
const side = argSide === 'sell' ? 'sell' : 'buy'
const amount = argAmount ? BigInt(argAmount) : 10n ** 16n

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  return (await r.json()) as { result?: string; error?: { message: string; data?: string } }
}

function candidates(): { label: string; address: string; swap_count: number }[] {
  if (argPool) return [{ label: 'pool', address: argPool.toLowerCase(), swap_count: 0 }]
  const db = new Database(DB, { readonly: true })
  const rows = db
    .prepare(
      `SELECT address, hooks, swap_count FROM pools
       WHERE version=4 AND factory_verified=1 AND token0=? AND base_is_token0 IS NOT NULL
         AND last_swap_block > (SELECT MAX(last_swap_block) FROM pools) - 200000
       ORDER BY swap_count DESC`,
    )
    .all(ZERO) as { address: string; hooks: string; swap_count: number }[]
  const hookless = rows.find((p) => p.hooks === ZERO)
  const hooked = rows.find((p) => p.hooks !== ZERO)
  return [hookless && { label: 'hookless v4', ...hookless }, hooked && { label: 'hooked v4', ...hooked }].filter(Boolean) as never
}

for (const p of candidates()) {
  const q = await (await fetch(`${WEB}/api/quote?pool=${p.address}&side=${side}&amount=${amount}&real=1`)).json()
  if (q.error) {
    console.log(`${p.label} ${p.address}: quote error: ${q.error}`)
    continue
  }
  const minOut = minOutFrom(BigInt(q.amountOut), 100)
  const tx = buildRouteSwap({ side, legs: q.route.exec, amountIn: BigInt(q.amountIn), minOut, recipient: WETH })
  console.log(`\n== ${p.label} ${p.address.slice(0, 14)}… swaps=${p.swap_count}\n   route ${q.route.label} · signer ${tx.router} · legs ${q.route.exec.length} · executable ${q.route.executable}`)
  const data = encodeFunctionData({ abi: tx.abi as never, functionName: tx.functionName, args: tx.args as never })
  const call = { from: WETH, to: tx.address, data, value: '0x' + tx.value.toString(16) }
  const sim = await rpc('eth_call', [call, 'latest'])
  console.log('   eth_call     ', sim.error ? `REVERT ${sim.error.message} ${sim.error.data ?? ''}`.slice(0, 160) : 'ok')
  const gas = await rpc('eth_estimateGas', [call])
  console.log('   estimateGas  ', gas.error ? `REVERT ${gas.error.message}`.slice(0, 160) : Number(gas.result).toLocaleString())
  console.log(`   quoted out    ${q.amountOut} · minOut ${minOut}`)
}
