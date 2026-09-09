import { createPublicClient, custom, defineChain, fallback, http, type PublicClient, type Transport } from 'viem'
import { CHAIN_ID, EXPLORER_URL, RPC_URL } from './addresses.js'

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: EXPLORER_URL },
  },
})

/** True when a dedicated (non-public) endpoint is configured. */
export const hasDedicatedRpc = (url = process.env.PAPERHANDS_RPC) => Boolean(url && url !== RPC_URL)

/**
 * Token bucket in front of a transport: at most `rps` HTTP requests per second,
 * bursts up to one second's worth. Free RPC plans cap requests per second and
 * answer the excess with 429s that cost retries and, on some providers, a
 * cool-down — better to queue on our side and never trip it.
 * `PAPERHANDS_RPC_RPS` sets it (default 8 on a dedicated key; 0 disables).
 */
function rateLimited(inner: Transport, rps: number): Transport {
  let tokens = rps
  let last = Date.now()
  const waiters: (() => void)[] = []
  const refill = () => {
    const now = Date.now()
    tokens = Math.min(rps, tokens + ((now - last) / 1000) * rps)
    last = now
  }
  const pump = () => {
    refill()
    while (tokens >= 1 && waiters.length) {
      tokens -= 1
      waiters.shift()!()
    }
    if (waiters.length) setTimeout(pump, Math.max(5, Math.ceil(((1 - tokens) / rps) * 1000)))
  }
  const acquire = () => new Promise<void>((resolve) => {
    waiters.push(resolve)
    if (waiters.length === 1) pump()
  })
  return (params) => {
    const t = inner(params)
    return custom({
      request: async ({ method, params: p }) => {
        await acquire()
        return t.request({ method, params: p } as never)
      },
    })(params)
  }
}

export function makeClient(rpcUrl = process.env.PAPERHANDS_RPC ?? RPC_URL): PublicClient {
  const opts = { retryCount: 5, retryDelay: 400, timeout: 30_000 }
  if (rpcUrl === RPC_URL) {
    // The public RPC mishandles JSON-RPC batch arrays, so batching stays off.
    return createPublicClient({ chain: robinhoodChain, transport: http(rpcUrl, opts) })
  }
  // Dedicated endpoint: batch calls (one HTTP round trip for up to `PAPERHANDS_RPC_BATCH`
  // reads, default 100 — a pool snapshot or a page of transaction lookups becomes a
  // single request; set 1 if the provider bills each item), throttled to the plan's
  // requests-per-second, with the public RPC as a fallback. Never the other way round:
  // the public node rate-limits and serves only recent state.
  const batchSize = Math.max(1, Number(process.env.PAPERHANDS_RPC_BATCH ?? 100))
  const rps = Number(process.env.PAPERHANDS_RPC_RPS ?? 8)
  const primary = http(rpcUrl, { ...opts, batch: batchSize > 1 ? { batchSize, wait: 12 } : false })
  const transport = fallback([rps > 0 ? rateLimited(primary, rps) : primary, http(RPC_URL, { ...opts, retryCount: 2 })], { rank: false })
  return createPublicClient({ chain: robinhoodChain, transport })
}

export type ChainClient = PublicClient
