import { UNISWAP, USDG, WETH, readTokenMeta, v3FactoryAbi, v3PoolAbi, type ChainClient } from '@paperhands/chain'
import type Database from 'better-sqlite3'
import { decodeEventLog, type AbiEvent, type Address, type Log } from 'viem'

export const V3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67' as const

/** The Swap event definition; getLogs derives the topic0 filter from it. */
export const swapEvent = v3PoolAbi.find((e) => e.type === 'event' && e.name === 'Swap') as AbiEvent
export const mintEvent = v3PoolAbi.find((e) => e.type === 'event' && e.name === 'Mint') as AbiEvent
export const burnEvent = v3PoolAbi.find((e) => e.type === 'event' && e.name === 'Burn') as AbiEvent

export interface DecodedSwap {
  pool: Address
  block: bigint
  txHash: `0x${string}`
  logIndex: number
  amount0: bigint
  amount1: bigint
  sqrtPriceX96: bigint
  liquidity: bigint
  tick: number
}

export function decodeSwapLog(log: Log): DecodedSwap | undefined {
  try {
    const d = decodeEventLog({ abi: v3PoolAbi, data: log.data, topics: log.topics, eventName: 'Swap' })
    return {
      pool: log.address as Address,
      block: log.blockNumber!,
      txHash: log.transactionHash!,
      logIndex: log.logIndex!,
      amount0: d.args.amount0,
      amount1: d.args.amount1,
      sqrtPriceX96: d.args.sqrtPriceX96,
      liquidity: d.args.liquidity,
      tick: d.args.tick,
    }
  } catch {
    return undefined
  }
}

/**
 * Chain-wide v3 Swap logs in [from, to]. The RPC caps a query at 10k logs,
 * so ranges that overflow are bisected until they fit.
 */
export async function fetchSwapLogs(
  client: ChainClient,
  fromBlock: bigint,
  toBlock: bigint,
  chunk = 1500n,
): Promise<DecodedSwap[]> {
  const out: DecodedSwap[] = []
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n
    out.push(...(await fetchRange(client, start, end)))
    if (end < toBlock) await new Promise((r) => setTimeout(r, 100))
  }
  return out
}

async function fetchRange(client: ChainClient, fromBlock: bigint, toBlock: bigint): Promise<DecodedSwap[]> {
  try {
    const logs = await client.getLogs({
      fromBlock,
      toBlock,
      event: swapEvent,
    })
    const out: DecodedSwap[] = []
    for (const log of logs) {
      const s = decodeSwapLog(log)
      if (s) out.push(s)
    }
    return out
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (fromBlock < toBlock && /limit|too many|response size|exceeds|timed out|timeout|EOF|ECONN|fetch failed|socket/i.test(msg)) {
      const mid = fromBlock + (toBlock - fromBlock) / 2n
      const left = await fetchRange(client, fromBlock, mid)
      const right = await fetchRange(client, mid + 1n, toBlock)
      return [...left, ...right]
    }
    throw err
  }
}

export interface DecodedLiqEvent {
  pool: Address
  block: bigint
  txHash: `0x${string}`
  logIndex: number
  /** +1 mint, -1 burn */
  kind: 1 | -1
  tickLower: number
  tickUpper: number
  amount: bigint
}

function decodeLiqLog(log: Log): DecodedLiqEvent | undefined {
  for (const [eventName, kind] of [['Mint', 1] as const, ['Burn', -1] as const]) {
    try {
      const d = decodeEventLog({ abi: v3PoolAbi, data: log.data, topics: log.topics, eventName })
      const args = d.args as { tickLower: number; tickUpper: number; amount: bigint }
      return {
        pool: log.address as Address,
        block: log.blockNumber!,
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
        kind,
        tickLower: Number(args.tickLower),
        tickUpper: Number(args.tickUpper),
        amount: args.amount,
      }
    } catch {
      // try the other event
    }
  }
  return undefined
}

/** Chain-wide Mint+Burn logs in [from, to], bisecting ranges the RPC caps. */
export async function fetchLiqLogs(
  client: ChainClient,
  fromBlock: bigint,
  toBlock: bigint,
  chunk = 3000n,
  address?: Address,
): Promise<DecodedLiqEvent[]> {
  const out: DecodedLiqEvent[] = []
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n
    out.push(...(await fetchLiqRange(client, start, end, address)))
    if (end < toBlock) await new Promise((r) => setTimeout(r, 80))
  }
  return out
}

async function fetchLiqRange(
  client: ChainClient,
  fromBlock: bigint,
  toBlock: bigint,
  address?: Address,
): Promise<DecodedLiqEvent[]> {
  try {
    const logs = await client.getLogs({
      ...(address ? { address } : {}),
      fromBlock,
      toBlock,
      events: [mintEvent, burnEvent],
    })
    const out: DecodedLiqEvent[] = []
    for (const log of logs) {
      const e = decodeLiqLog(log)
      if (e) out.push(e)
    }
    return out
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (fromBlock < toBlock && /limit|too many|response size|exceeds|timed out|timeout|EOF|ECONN|fetch failed|socket/i.test(msg)) {
      const mid = fromBlock + (toBlock - fromBlock) / 2n
      return [
        ...(await fetchLiqRange(client, fromBlock, mid, address)),
        ...(await fetchLiqRange(client, mid + 1n, toBlock, address)),
      ]
    }
    throw err
  }
}

export function insertLiqEvents(db: Database.Database, events: DecodedLiqEvent[], knownPoolsOnly = true): number {
  const known = new Set(
    (db.prepare('SELECT address FROM pools').all() as { address: string }[]).map((r) => r.address),
  )
  const ins = db.prepare(
    `INSERT OR IGNORE INTO liq_events(tx_hash, log_index, pool, block, kind, tick_lower, tick_upper, amount)
     VALUES(?,?,?,?,?,?,?,?)`,
  )
  let n = 0
  const tx = db.transaction(() => {
    for (const e of events) {
      const pool = e.pool.toLowerCase()
      if (knownPoolsOnly && !known.has(pool)) continue
      const r = ins.run(e.txHash, e.logIndex, pool, Number(e.block), e.kind, e.tickLower, e.tickUpper, e.amount.toString())
      n += r.changes
    }
  })
  tx()
  return n
}

interface PoolRow {
  address: string
  token0: string
  token1: string
  fee: number
  tick_spacing: number
  base_is_token0: number | null
  factory_verified: number
}

/**
 * Resolve an unknown pool address: read its immutables, verify it against
 * the canonical factory (anyone can emit Swap-shaped logs — only
 * factory-verified pools are real), and persist tokens + pool.
 * Returns undefined for contracts that aren't v3-pool-shaped at all.
 */
export async function resolvePool(
  client: ChainClient,
  db: Database.Database,
  pool: Address,
  discoveredBlock: bigint,
): Promise<PoolRow | undefined> {
  const p = { address: pool, abi: v3PoolAbi } as const
  let token0: Address, token1: Address, fee: number, tickSpacing: number
  try {
    ;[token0, token1, fee, tickSpacing] = await Promise.all([
      client.readContract({ ...p, functionName: 'token0' }),
      client.readContract({ ...p, functionName: 'token1' }),
      client.readContract({ ...p, functionName: 'fee' }).then(Number),
      client.readContract({ ...p, functionName: 'tickSpacing' }).then(Number),
    ])
  } catch {
    return undefined
  }

  // "Checked and it is not the canonical pool" and "could not check" are not the
  // same thing: a 429 here must not brand a real pool unverified forever. On a
  // failed read we give up on this pool for now; its next swap retries it.
  let verified: boolean
  try {
    const canonical = await client.readContract({
      address: UNISWAP.v3Factory,
      abi: v3FactoryAbi,
      functionName: 'getPool',
      args: [token0, token1, fee],
    })
    verified = canonical.toLowerCase() === pool.toLowerCase()
  } catch {
    return undefined
  }

  for (const t of [token0, token1]) {
    await upsertToken(client, db, t, discoveredBlock)
  }

  // Quote preference: WETH first, then USDG — a pool with neither stays
  // recorded but unpriced.
  const wethLower = WETH.toLowerCase()
  const usdgLower = USDG.toLowerCase()
  let baseIsToken0: number | null = null
  let quoteSymbol: string | null = null
  if (token1.toLowerCase() === wethLower) [baseIsToken0, quoteSymbol] = [1, 'WETH']
  else if (token0.toLowerCase() === wethLower) [baseIsToken0, quoteSymbol] = [0, 'WETH']
  else if (token1.toLowerCase() === usdgLower) [baseIsToken0, quoteSymbol] = [1, 'USDG']
  else if (token0.toLowerCase() === usdgLower) [baseIsToken0, quoteSymbol] = [0, 'USDG']

  const row: PoolRow = {
    address: pool.toLowerCase(),
    token0: token0.toLowerCase(),
    token1: token1.toLowerCase(),
    fee,
    tick_spacing: tickSpacing,
    base_is_token0: baseIsToken0,
    factory_verified: verified ? 1 : 0,
  }
  db.prepare(
    `INSERT INTO pools(address, version, token0, token1, fee, tick_spacing, base_is_token0, factory_verified, discovered_block, quote_symbol)
     VALUES(?, 3, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO NOTHING`,
  ).run(
    row.address,
    row.token0,
    row.token1,
    fee,
    tickSpacing,
    baseIsToken0,
    row.factory_verified,
    Number(discoveredBlock),
    quoteSymbol,
  )
  return row
}

export async function upsertToken(client: ChainClient, db: Database.Database, address: Address, block: bigint) {
  const existing = db.prepare('SELECT address FROM tokens WHERE address = ?').get(address.toLowerCase())
  if (existing) return
  try {
    const meta = await readTokenMeta(client, address)
    db.prepare('INSERT OR IGNORE INTO tokens(address, symbol, name, decimals, first_seen_block) VALUES(?,?,?,?,?)').run(
      address.toLowerCase(),
      meta.symbol.slice(0, 32),
      meta.name.slice(0, 64),
      meta.decimals,
      Number(block),
    )
  } catch {
    // Do NOT persist a placeholder: a guessed decimals=18 would corrupt every
    // price for this token forever. Leaving no row means the pool stays
    // unloadable and resolution retries on the token's next swap.
  }
}
