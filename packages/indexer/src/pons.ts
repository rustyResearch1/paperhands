import type Database from 'better-sqlite3'
import { decodeEventLog, parseAbi, type Address, type Log } from 'viem'
import type { ChainClient } from '@paperhands/chain'
import { upsertToken } from './discover.js'
import type { BlockClock } from './timestamps.js'

/**
 * PONS — the launchpad where most of Robinhood Chain's new tokens are born.
 *
 * A launch mints the whole supply into a bonding curve (constant product on a
 * phantom quote reserve, plus a fee, a creator tax and a snipe tax that decays
 * over the first seconds). Buys and sells happen on that curve contract, NOT
 * on Uniswap, until the curve's real reserve reaches the graduation threshold;
 * then the factory seeds a permanently locked Uniswap v4 pool under the shared
 * meme hook and trading continues there — where our swap indexer already sees
 * it. Everything before graduation was invisible to us until this module.
 *
 * Two things make this stream cheap and honest:
 * - the curve's own events carry the trader's address, so attribution is free
 *   (no per-transaction lookups, unlike Uniswap swaps);
 * - the token keeps its address through graduation, so a wallet's curve buys
 *   and later v4 sells can be replayed as one position.
 */
export const PONS = {
  factoryV2: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as Address,
  /** Every graduated launch trades under this v4 hook. */
  memeHook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044' as Address,
  native: '0x0000000000000000000000000000000000000000' as Address,
} as const

export const ponsFactoryAbi = parseAbi([
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
  'event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)',
])

export const ponsCurveAbi = parseAbi([
  'event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)',
  'event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)',
  'event CurveCompleted(address recipient, uint256 quoteOut, uint256 tokenOut)',
  'function token() view returns (address)',
  'function deployer() view returns (address)',
  'function pairToken() view returns (address)',
  'function graduationThreshold() view returns (uint256)',
  'function launchedAt() view returns (uint256)',
  'function phantomQuote() view returns (uint256)',
  'function feeBps() view returns (uint256)',
  'function creatorTaxBps() view returns (uint256)',
  'function snipeTaxStartBps() view returns (uint256)',
  'function snipeTaxSeconds() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function getReserves() view returns (uint256 quoteReserve_, uint256 tokenReserve_)',
  'function realQuoteReserve() view returns (uint256)',
  'function sellableTokens() view returns (uint256)',
  'function currentSnipeTaxBps(address recipient) view returns (uint256)',
])

export interface DecodedLaunch {
  token: string
  curve: string
  deployer: string
  pairToken: string
  configId: number
  graduationThreshold: bigint
  block: bigint
  txHash: string
}
export interface DecodedGraduation {
  token: string
  block: bigint
  txHash: string
  tokenAmount: bigint
  pairTokenAmount: bigint
}
export interface DecodedCurveTrade {
  curve: string
  block: bigint
  txHash: string
  logIndex: number
  side: 'buy' | 'sell'
  trader: string
  recipient: string
  quote: bigint
  tokens: bigint
  fee: bigint
  tax: bigint
}
export interface PonsLogs {
  launches: DecodedLaunch[]
  graduations: DecodedGraduation[]
  trades: DecodedCurveTrade[]
}

const lower = (a: string) => a.toLowerCase()

/**
 * All PONS activity in a block range: factory logs (address-filtered, cheap)
 * and curve trades (topic-filtered across every curve, like our swap stream).
 * Bisects on provider limits exactly as the swap fetcher does.
 */
export async function fetchPonsLogs(client: ChainClient, fromBlock: bigint, toBlock: bigint): Promise<PonsLogs> {
  const out: PonsLogs = { launches: [], graduations: [], trades: [] }
  const [factory, curves] = await Promise.all([
    fetchRange(client, fromBlock, toBlock, { address: PONS.factoryV2, events: [ponsFactoryAbi[0], ponsFactoryAbi[1]] }),
    fetchRange(client, fromBlock, toBlock, { events: [ponsCurveAbi[0], ponsCurveAbi[1]] }),
  ])
  for (const log of factory) {
    try {
      const d = decodeEventLog({ abi: ponsFactoryAbi, data: log.data, topics: log.topics })
      if (d.eventName === 'TokenLaunched') {
        const a = d.args as { token: Address; curve: Address; deployer: Address; pairToken: Address; launchConfigId: bigint; graduationThreshold: bigint }
        out.launches.push({ token: lower(a.token), curve: lower(a.curve), deployer: lower(a.deployer), pairToken: lower(a.pairToken), configId: Number(a.launchConfigId), graduationThreshold: a.graduationThreshold, block: log.blockNumber!, txHash: log.transactionHash! })
      } else if (d.eventName === 'PoolGraduated') {
        const a = d.args as { token: Address; positionId: bigint; tokenAmount: bigint; pairTokenAmount: bigint }
        out.graduations.push({ token: lower(a.token), block: log.blockNumber!, txHash: log.transactionHash!, tokenAmount: a.tokenAmount, pairTokenAmount: a.pairTokenAmount })
      }
    } catch {
      // not ours
    }
  }
  for (const log of curves) {
    try {
      const d = decodeEventLog({ abi: ponsCurveAbi, data: log.data, topics: log.topics })
      if (d.eventName === 'CurveBuy') {
        const a = d.args as { buyer: Address; recipient: Address; quoteIn: bigint; tokensOut: bigint; fee: bigint; tax: bigint }
        out.trades.push({ curve: lower(log.address), block: log.blockNumber!, txHash: log.transactionHash!, logIndex: log.logIndex!, side: 'buy', trader: lower(a.buyer), recipient: lower(a.recipient), quote: a.quoteIn, tokens: a.tokensOut, fee: a.fee, tax: a.tax })
      } else if (d.eventName === 'CurveSell') {
        const a = d.args as { seller: Address; recipient: Address; tokensIn: bigint; quoteOut: bigint; fee: bigint; tax: bigint }
        out.trades.push({ curve: lower(log.address), block: log.blockNumber!, txHash: log.transactionHash!, logIndex: log.logIndex!, side: 'sell', trader: lower(a.seller), recipient: lower(a.recipient), quote: a.quoteOut, tokens: a.tokensIn, fee: a.fee, tax: a.tax })
      }
    } catch {
      // a log with a colliding topic from some other contract; skip
    }
  }
  return out
}

async function fetchRange(client: ChainClient, fromBlock: bigint, toBlock: bigint, filter: { address?: Address; events: readonly unknown[] }): Promise<Log[]> {
  try {
    return (await client.getLogs({ fromBlock, toBlock, address: filter.address, events: filter.events as never })) as Log[]
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (fromBlock < toBlock && /limit|too many|response size|exceeds|timed out|timeout|EOF|ECONN|fetch failed|socket/i.test(msg)) {
      const mid = fromBlock + (toBlock - fromBlock) / 2n
      return [...(await fetchRange(client, fromBlock, mid, filter)), ...(await fetchRange(client, mid + 1n, toBlock, filter))]
    }
    throw err
  }
}

/**
 * A curve we see trading but never saw launched (it predates our first PONS
 * block). One read of its immutables registers it so its trades are not lost.
 * Bounded per tick so a catch-up burst cannot fan out into hundreds of reads.
 */
async function resolveCurve(client: ChainClient, db: Database.Database, curve: Address, block: bigint, clock: BlockClock): Promise<boolean> {
  try {
    const c = { address: curve, abi: ponsCurveAbi } as const
    const [token, deployer, pairToken, threshold, launchedAt] = await Promise.all([
      client.readContract({ ...c, functionName: 'token' }),
      client.readContract({ ...c, functionName: 'deployer' }),
      client.readContract({ ...c, functionName: 'pairToken' }),
      client.readContract({ ...c, functionName: 'graduationThreshold' }),
      client.readContract({ ...c, functionName: 'launchedAt' }),
    ])
    if (!token || token === PONS.native) return false
    await upsertToken(client, db, token, block)
    db.prepare(
      `INSERT OR IGNORE INTO launches(token, curve, deployer, pair_token, config_id, graduation_threshold, launch_block, launch_ts, launch_tx)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(lower(token), lower(curve), lower(deployer), lower(pairToken), -1, threshold.toString(), Number(block), Number(launchedAt) || clock.estimate(block), '')
    return true
  } catch {
    return false
  }
}

export interface PonsIngestResult {
  launches: number
  trades: number
  graduations: number
  unknownCurves: number
}

/** Persist a range's PONS activity and keep each launch's running totals current. */
export async function ingestPons(client: ChainClient, db: Database.Database, logs: PonsLogs, clock: BlockClock, maxResolve = 40): Promise<PonsIngestResult> {
  const insertLaunch = db.prepare(
    `INSERT OR IGNORE INTO launches(token, curve, deployer, pair_token, config_id, graduation_threshold, launch_block, launch_ts, launch_tx)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  )
  const curveToToken = new Map<string, string>()
  const lookup = db.prepare(`SELECT token FROM launches WHERE curve = ?`)
  const tokenFor = (curve: string): string | null => {
    const hit = curveToToken.get(curve)
    if (hit) return hit
    const row = lookup.get(curve) as { token: string } | undefined
    if (row) curveToToken.set(curve, row.token)
    return row?.token ?? null
  }

  // Launches first, so this range's own trades can find their token.
  let launches = 0
  for (const l of logs.launches) {
    await upsertToken(client, db, l.token as Address, l.block)
    // Launches are quoted in ETH, USDG or a tokenized stock (NVDA, GOOGL, TSLA…): the
    // pair token's decimals decide how every amount below reads.
    if (l.pairToken !== PONS.native) await upsertToken(client, db, l.pairToken as Address, l.block)
    const r = insertLaunch.run(l.token, l.curve, l.deployer, l.pairToken, l.configId, l.graduationThreshold.toString(), Number(l.block), clock.estimate(l.block), l.txHash)
    if (r.changes > 0) launches++
    curveToToken.set(l.curve, l.token)
  }

  // Trades on curves we have never seen: register up to `maxResolve` of them.
  const unknown = [...new Set(logs.trades.map((t) => t.curve).filter((c) => !tokenFor(c)))]
  let resolved = 0
  for (const curve of unknown.slice(0, maxResolve)) {
    const first = logs.trades.find((t) => t.curve === curve)!
    if (await resolveCurve(client, db, curve as Address, first.block, clock)) {
      resolved++
      curveToToken.delete(curve)
    }
  }

  const insertTrade = db.prepare(
    `INSERT OR IGNORE INTO curve_trades(tx_hash, log_index, curve, token, block, ts, side, trader, recipient, quote_raw, tokens_raw, fee_raw, tax_raw)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const bump = db.prepare(
    `UPDATE launches SET
       buys = buys + ?, sells = sells + ?,
       quote_in = quote_in + ?, quote_out = quote_out + ?,
       fees = fees + ?, taxes = taxes + ?,
       tokens_out = tokens_out + ?, tokens_in = tokens_in + ?,
       last_trade_block = MAX(COALESCE(last_trade_block, 0), ?), last_price = ?,
       traders = (SELECT COUNT(DISTINCT trader) FROM curve_trades WHERE token = launches.token)
     WHERE token = ?`,
  )
  const decimalsOf = db.prepare(`SELECT decimals FROM tokens WHERE address = ?`)
  const pairOf = db.prepare(`SELECT pair_token FROM launches WHERE token = ?`)
  const decCache = new Map<string, number>()
  const decimals = (address: string): number => {
    if (address === PONS.native) return 18
    const hit = decCache.get(address)
    if (hit !== undefined) return hit
    const d = (decimalsOf.get(address) as { decimals: number } | undefined)?.decimals ?? 18
    decCache.set(address, d)
    return d
  }
  let trades = 0
  const tx = db.transaction(() => {
    for (const t of logs.trades) {
      const token = tokenFor(t.curve)
      if (!token) continue
      const ins = insertTrade.run(t.txHash, t.logIndex, t.curve, token, Number(t.block), clock.estimate(t.block), t.side, t.trader, t.recipient, t.quote.toString(), t.tokens.toString(), t.fee.toString(), t.tax.toString())
      if (ins.changes === 0) continue
      trades++
      const dec = decimals(token)
      const pair = (pairOf.get(token) as { pair_token: string } | undefined)?.pair_token ?? PONS.native
      // Price in the pair token's human units per launch token.
      const price = t.tokens > 0n ? Number(t.quote) / 10 ** decimals(pair) / (Number(t.tokens) / 10 ** dec) : null
      const isBuy = t.side === 'buy'
      bump.run(isBuy ? 1 : 0, isBuy ? 0 : 1, isBuy ? Number(t.quote) : 0, isBuy ? 0 : Number(t.quote), Number(t.fee), Number(t.tax), isBuy ? Number(t.tokens) : 0, isBuy ? 0 : Number(t.tokens), Number(t.block), price, token)
    }
    for (const g of logs.graduations) {
      db.prepare(`UPDATE launches SET graduated_block = ?, graduated_ts = ?, graduation_tx = ? WHERE token = ? AND graduated_block IS NULL`).run(Number(g.block), clock.estimate(g.block), g.txHash, g.token)
    }
  })
  tx()
  linkGraduatedPools(db)
  return { launches, trades, graduations: logs.graduations.length, unknownCurves: unknown.length - resolved }
}

/**
 * A graduated launch continues on a v4 pool under the meme hook; the swap
 * indexer registers that pool on its first swap, which can land a tick or two
 * after the graduation event. Link whatever is linkable each time.
 */
export function linkGraduatedPools(db: Database.Database): number {
  return db
    .prepare(
      `UPDATE launches SET pool = (
         SELECT p.address FROM pools p
         WHERE lower(p.hooks) = ? AND (p.token0 = launches.token OR p.token1 = launches.token)
         ORDER BY p.discovered_block DESC LIMIT 1
       )
       WHERE graduated_block IS NOT NULL AND pool IS NULL`,
    )
    .run(PONS.memeHook.toLowerCase()).changes
}

/**
 * Recompute each launch's last price from its newest trade, in the pair
 * token's own decimals. A one-off repair for rows written before quote
 * decimals were honoured (USDG is 6, cbBTC is 8); harmless to rerun.
 */
export function repairLaunchPrices(db: Database.Database): number {
  return db
    .prepare(
      `UPDATE launches SET last_price = (
         SELECT (CAST(c.quote_raw AS REAL) / POWER(10, COALESCE(q.decimals, 18))) / (CAST(c.tokens_raw AS REAL) / POWER(10, t.decimals))
         FROM curve_trades c JOIN tokens t ON t.address = c.token LEFT JOIN tokens q ON q.address = launches.pair_token
         WHERE c.token = launches.token AND CAST(c.tokens_raw AS REAL) > 0
         ORDER BY c.block DESC, c.log_index DESC LIMIT 1
       ) WHERE buys > 0`,
    )
    .run().changes
}

/** Curve pricing, ported: constant product on the phantom reserve. */
export function curveAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n || feeBps >= 10_000n) return 0n
  const inLessFee = amountIn * (10_000n - feeBps)
  return (inLessFee * reserveOut) / (reserveIn * 10_000n + inLessFee)
}

/** The launch-second snipe tax: starts at `startBps` and halves fourteen times across the window. */
export function snipeTaxBpsAt(startBps: bigint, launchedAt: number, windowSec: number, nowSec: number): bigint {
  if (startBps === 0n || windowSec <= 0) return 0n
  const elapsed = Math.max(0, nowSec - launchedAt)
  if (elapsed >= windowSec) return 0n
  return startBps >> BigInt(Math.floor((elapsed * 14) / windowSec))
}
