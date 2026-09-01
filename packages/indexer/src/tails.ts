import { readV3Pool, type ChainClient, type V3PoolSnapshot } from '@paperhands/chain'
import { quoteV3ExactIn } from '@paperhands/engine'
import type Database from 'better-sqlite3'
import type { Address } from 'viem'
import { LedgerRejected, settlePaperTrade } from './ledger.js'
import { basePriceInQuote } from './prices.js'

interface TailRow {
  user_id: string
  wallet: string
  size_quote: string
  last_block: number
}

interface KolSwapRow {
  tx_hash: string
  pool: string
  block: number
  ts: number
  amount0: string
  amount1: string
  base_is_token0: number
  d0: number
  d1: number
}

/**
 * Mirror tailed wallets: when a tailed wallet buys a pool, buy it with the
 * tail's fixed size; when it sells a pool, exit the whole tailed position.
 * Fills go through the same honest engine + fresh pool reads as manual
 * trades — a tail is not a discount on execution truth.
 */
export async function executeTails(client: ChainClient, db: Database.Database): Promise<number> {
  const tails = db.prepare('SELECT user_id, wallet, size_quote, last_block FROM kol_tails WHERE active = 1').all() as TailRow[]
  if (tails.length === 0) return 0

  const snapCache = new Map<string, V3PoolSnapshot>()
  const kolSwaps = db.prepare(
    `SELECT s.tx_hash, s.pool, s.block, s.ts, s.amount0, s.amount1,
            p.base_is_token0, t0.decimals AS d0, t1.decimals AS d1
     FROM swaps s
     JOIN pools p ON p.address = s.pool
     JOIN tokens t0 ON t0.address = p.token0
     JOIN tokens t1 ON t1.address = p.token1
     WHERE s.trader = ? AND s.block > ? AND p.base_is_token0 IS NOT NULL AND p.factory_verified = 1
     ORDER BY s.block ASC, s.log_index ASC LIMIT 25`,
  )
  const bumpCursor = db.prepare('UPDATE kol_tails SET last_block = ? WHERE user_id = ? AND wallet = ?')

  let fills = 0
  for (const tail of tails) {
    const swaps = kolSwaps.all(tail.wallet, tail.last_block) as KolSwapRow[]
    let cursor = tail.last_block
    for (const s of swaps) {
      cursor = Math.max(cursor, s.block)
      try {
        const filled = await mirrorSwap(client, db, tail, s, snapCache)
        if (filled) fills++
      } catch (err) {
        if (!(err instanceof LedgerRejected)) {
          console.error(`tails: mirror failed for ${tail.user_id}←${tail.wallet} on ${s.pool}:`, (err as Error).message.split('\n')[0])
        }
        // Either way, don't retry this swap forever — the cursor advances.
      }
    }
    if (cursor !== tail.last_block) bumpCursor.run(cursor, tail.user_id, tail.wallet)
  }
  return fills
}

async function mirrorSwap(
  client: ChainClient,
  db: Database.Database,
  tail: TailRow,
  s: KolSwapRow,
  snapCache: Map<string, V3PoolSnapshot>,
): Promise<boolean> {
  const baseIsToken0 = s.base_is_token0 === 1
  const ethAmt = BigInt(baseIsToken0 ? s.amount1 : s.amount0)
  const kolBought = ethAmt > 0n // ETH flowed into the pool

  let amountIn: bigint
  if (kolBought) {
    amountIn = BigInt(tail.size_quote)
    // Bankroll floor: an active whale-tail must not spend the account to
    // dust — keep a reserve so manual trading stays possible.
    const RESERVE = 10n ** 18n / 2n
    const bal = db.prepare('SELECT balance_quote FROM users WHERE id = ?').get(tail.user_id) as
      | { balance_quote: string }
      | undefined
    if (!bal || BigInt(bal.balance_quote) < amountIn + RESERVE) return false
  } else {
    const pos = db
      .prepare('SELECT qty FROM positions WHERE user_id = ? AND pool = ?')
      .get(tail.user_id, s.pool) as { qty: string } | undefined
    amountIn = BigInt(pos?.qty ?? '0')
    if (amountIn === 0n) return false // nothing to exit
  }

  let snap = snapCache.get(s.pool)
  if (!snap) {
    snap = await readV3Pool(client, s.pool as Address)
    snapCache.set(s.pool, snap)
  }

  const zeroForOne = kolBought ? !baseIsToken0 : baseIsToken0
  const q = quoteV3ExactIn(snap.state, amountIn, zeroForOne)
  if (q.amountIn !== amountIn || q.exhaustedWindow || q.amountOut <= 0n) return false

  const baseDecimals = baseIsToken0 ? s.d0 : s.d1
  const quoteDecimals = baseIsToken0 ? s.d1 : s.d0
  const spotPrice = basePriceInQuote(snap.state.sqrtPriceX96, baseIsToken0, baseDecimals, quoteDecimals)
  const rawRatio = Number(q.amountOut) / Number(q.amountIn)
  const execPrice = kolBought ? (1 / rawRatio) * 10 ** (baseDecimals - 18) : rawRatio * 10 ** (baseDecimals - 18)
  const feeQuote = kolBought ? q.feeAmount : BigInt(Math.round(Number(q.feeAmount) * rawRatio))

  settlePaperTrade(db, {
    userId: tail.user_id,
    pool: s.pool,
    side: kolBought ? 'buy' : 'sell',
    consumed: q.amountIn,
    amountOut: q.amountOut,
    feeQuote,
    priceImpactBps: q.priceImpactBps,
    fillRatio: q.fillRatio,
    spotPrice,
    execPrice,
    block: Number(snap.blockNumber),
    ts: Math.floor(Date.now() / 1000),
    source: `tail:${tail.wallet}`,
  })
  return true
}
