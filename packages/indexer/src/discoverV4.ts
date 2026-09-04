import { NATIVE, UNISWAP, USDG, WETH, readTokenMeta, v4PoolManagerAbi, type ChainClient } from '@paperhands/chain'
import type Database from 'better-sqlite3'
import { decodeEventLog, type AbiEvent, type Address, type Hex, type Log } from 'viem'
import type { DecodedLiqEvent, DecodedSwap } from './discover.js'

const initEvent = v4PoolManagerAbi.find((e) => e.name === 'Initialize') as AbiEvent
const swapEvent = v4PoolManagerAbi.find((e) => e.name === 'Swap') as AbiEvent
const modLiqEvent = v4PoolManagerAbi.find((e) => e.name === 'ModifyLiquidity') as AbiEvent

export const HOOKLESS = '0x0000000000000000000000000000000000000000'

export interface V4Init {
  id: string
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
  block: bigint
}

export interface V4Logs {
  inits: V4Init[]
  swaps: DecodedSwap[]
  liq: DecodedLiqEvent[]
}

function decodeV4Log(log: Log): { kind: 'init'; init: V4Init } | { kind: 'swap'; swap: DecodedSwap } | { kind: 'liq'; liq: DecodedLiqEvent } | undefined {
  for (const [ev, kind] of [
    [swapEvent, 'swap'],
    [modLiqEvent, 'liq'],
    [initEvent, 'init'],
  ] as const) {
    try {
      const d = decodeEventLog({ abi: [ev], data: log.data, topics: log.topics })
      const a = d.args as Record<string, unknown>
      if (kind === 'init') {
        return {
          kind,
          init: {
            id: (a.id as string).toLowerCase(),
            currency0: a.currency0 as Address,
            currency1: a.currency1 as Address,
            fee: Number(a.fee),
            tickSpacing: Number(a.tickSpacing),
            hooks: a.hooks as Address,
            block: log.blockNumber!,
          },
        }
      }
      if (kind === 'swap') {
        return {
          kind,
          swap: {
            pool: (a.id as string).toLowerCase() as Address,
            block: log.blockNumber!,
            txHash: log.transactionHash!,
            logIndex: log.logIndex!,
            // v4 emits deltas from the swapper's perspective (input negative);
            // flip to v3's pool-perspective convention so every downstream
            // consumer (candles, tape, wire, tails, replay) stays uniform.
            amount0: -(a.amount0 as bigint),
            amount1: -(a.amount1 as bigint),
            sqrtPriceX96: a.sqrtPriceX96 as bigint,
            liquidity: a.liquidity as bigint,
            tick: Number(a.tick),
          },
        }
      }
      const delta = a.liquidityDelta as bigint
      return {
        kind,
        liq: {
          pool: (a.id as string).toLowerCase() as Address,
          block: log.blockNumber!,
          txHash: log.transactionHash!,
          logIndex: log.logIndex!,
          kind: delta >= 0n ? 1 : -1,
          tickLower: Number(a.tickLower),
          tickUpper: Number(a.tickUpper),
          amount: delta >= 0n ? delta : -delta,
        },
      }
    } catch {
      // try next event shape
    }
  }
  return undefined
}

/** All PoolManager activity in [from, to], bisecting when the RPC balks. */
export async function fetchV4Logs(client: ChainClient, fromBlock: bigint, toBlock: bigint, chunk = 1500n): Promise<V4Logs> {
  const out: V4Logs = { inits: [], swaps: [], liq: [] }
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n
    await fetchV4Range(client, start, end, out)
    if (end < toBlock) await new Promise((r) => setTimeout(r, 80))
  }
  return out
}

async function fetchV4Range(client: ChainClient, fromBlock: bigint, toBlock: bigint, out: V4Logs): Promise<void> {
  try {
    const logs = await client.getLogs({
      address: UNISWAP.v4PoolManager,
      fromBlock,
      toBlock,
      events: [initEvent, swapEvent, modLiqEvent],
    })
    for (const log of logs) {
      const d = decodeV4Log(log)
      if (!d) continue
      if (d.kind === 'init') out.inits.push(d.init)
      else if (d.kind === 'swap') out.swaps.push(d.swap)
      else out.liq.push(d.liq)
    }
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (fromBlock < toBlock && /limit|too many|response size|exceeds|timed out|timeout|EOF|ECONN|fetch failed|socket/i.test(msg)) {
      const mid = fromBlock + (toBlock - fromBlock) / 2n
      await fetchV4Range(client, fromBlock, mid, out)
      await fetchV4Range(client, mid + 1n, toBlock, out)
      return
    }
    throw err
  }
}

/** Quote preference: wrapped ETH beats native beats USDG (both sides can qualify). */
function classifyQuote(c0: Address, c1: Address): { baseIsToken0: number | null; quoteSymbol: string | null } {
  const is = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase()
  for (const [addr, sym] of [
    [WETH, 'WETH'],
    [NATIVE, 'ETH'],
    [USDG, 'USDG'],
  ] as const) {
    if (is(c1, addr)) return { baseIsToken0: 1, quoteSymbol: sym }
    if (is(c0, addr)) return { baseIsToken0: 0, quoteSymbol: sym }
  }
  return { baseIsToken0: null, quoteSymbol: null }
}

async function upsertCurrency(client: ChainClient, db: Database.Database, address: Address, block: bigint) {
  const key = address.toLowerCase()
  if (db.prepare('SELECT 1 FROM tokens WHERE address = ?').get(key)) return
  if (key === NATIVE.toLowerCase()) {
    db.prepare('INSERT OR IGNORE INTO tokens(address, symbol, name, decimals, first_seen_block) VALUES(?,?,?,?,?)').run(
      key,
      'ETH',
      'Native Ether',
      18,
      Number(block),
    )
    return
  }
  try {
    const meta = await readTokenMeta(client, address)
    db.prepare('INSERT OR IGNORE INTO tokens(address, symbol, name, decimals, first_seen_block) VALUES(?,?,?,?,?)').run(
      key,
      meta.symbol.slice(0, 32),
      meta.name.slice(0, 64),
      meta.decimals,
      Number(block),
    )
  } catch {
    // unreadable token: no placeholder row — resolution retries later
  }
}

/** Persist a v4 pool from its Initialize event. PoolManager provenance = verified. */
export async function registerV4Pool(client: ChainClient, db: Database.Database, init: V4Init): Promise<void> {
  await upsertCurrency(client, db, init.currency0, init.block)
  await upsertCurrency(client, db, init.currency1, init.block)
  const { baseIsToken0, quoteSymbol } = classifyQuote(init.currency0, init.currency1)
  db.prepare(
    `INSERT INTO pools(address, version, token0, token1, fee, tick_spacing, base_is_token0, factory_verified, discovered_block, hooks, quote_symbol)
     VALUES(?,4,?,?,?,?,?,1,?,?,?)
     ON CONFLICT(address) DO NOTHING`,
  ).run(
    init.id,
    init.currency0.toLowerCase(),
    init.currency1.toLowerCase(),
    init.fee,
    init.tickSpacing,
    baseIsToken0,
    Number(init.block),
    init.hooks.toLowerCase(),
    quoteSymbol,
  )
}

/** Liquidity history for one v4 pool id (topic-filtered — cheap catchup). */
export async function fetchV4LiqForPool(
  client: ChainClient,
  id: string,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<DecodedLiqEvent[]> {
  const logs = await client.getLogs({
    address: UNISWAP.v4PoolManager,
    event: modLiqEvent,
    args: { id: id as Hex },
    fromBlock,
    toBlock,
  })
  const out: DecodedLiqEvent[] = []
  for (const log of logs) {
    const d = decodeV4Log(log)
    if (d?.kind === 'liq') out.push(d.liq)
  }
  return out
}

/** A swap referenced a pool we haven't seen: find its Initialize by topic. */
export async function resolveV4PoolById(client: ChainClient, db: Database.Database, id: string): Promise<boolean> {
  try {
    const logs = await client.getLogs({
      address: UNISWAP.v4PoolManager,
      event: initEvent,
      args: { id: id as Hex },
      fromBlock: 1n,
    })
    const log = logs[0]
    if (!log) return false
    const d = decodeV4Log(log)
    if (!d || d.kind !== 'init') return false
    await registerV4Pool(client, db, d.init)
    return true
  } catch {
    return false
  }
}
