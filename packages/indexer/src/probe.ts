import { makeClient, v3PoolAbi } from '@paperhands/chain'
import type { Address } from 'viem'
import { fetchSwapLogs } from './discover.js'

const client = makeClient()
const t0 = Date.now()
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`)

const latest = await client.getBlockNumber()
log(`latest=${latest}`)

const swaps = await fetchSwapLogs(client, latest - 1500n, latest)
log(`fetched ${swaps.length} swaps`)

const pools = [...new Set(swaps.map((s) => s.pool.toLowerCase()))]
log(`${pools.length} distinct pools; resolving first 3 sequentially`)

for (const pool of pools.slice(0, 3)) {
  const t = Date.now()
  const token0 = await client.readContract({ address: pool as Address, abi: v3PoolAbi, functionName: 'token0' })
  log(`pool ${pool} token0=${token0} (${Date.now() - t}ms)`)
}
log('probe done')
process.exit(0)
