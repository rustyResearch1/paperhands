import { UNISWAP, WETH, erc20Abi, nfpmAbi } from '@paperhands/chain'
import { readPoolState } from '@paperhands/indexer'
import { getAmountsForLiquidity, getSqrtRatioAtTick } from '@paperhands/engine'
import type { Address } from 'viem'
import { chainClient } from './chain'
import { db } from './db'
import { bestFill } from './route'
import { USDG } from './venues'

/**
 * The real wallet, seen through the same honesty lens as the paper ledger:
 * holdings valued at what the pool would pay to exit, not the chart.
 */

export interface Holding {
  token: string
  symbol: string
  decimals: number
  balance: string
  /** Best-route exit value in ETH wei, null when unroutable. */
  realizableWei: string | null
  markEth: number | null
}

export interface WalletHoldings {
  address: string
  ethWei: string
  holdings: Holding[]
  totalRealizableWei: string
  fetchedAt: number
}

const cache = new Map<string, { at: number; value: WalletHoldings }>()

export async function walletHoldings(address: string): Promise<WalletHoldings> {
  const key = address.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return hit.value

  const ethWei = await chainClient.getBalance({ address: key as Address })

  // Candidate tokens: what this wallet has traded (top by recency), plus the
  // chain's staples. Thousands of tracked tokens is too many balance reads.
  const traded = db
    .prepare(
      `SELECT tb.address AS token, tb.symbol, tb.decimals, MAX(s.block) AS last
       FROM swaps s JOIN pools p ON p.address = s.pool
       JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
       WHERE s.trader = ? AND p.base_is_token0 IS NOT NULL
       GROUP BY tb.address ORDER BY last DESC LIMIT 20`,
    )
    .all(key) as { token: string; symbol: string; decimals: number }[]
  const staples = db
    .prepare(`SELECT address AS token, symbol, decimals FROM tokens WHERE address IN (?, ?)`)
    .all(WETH.toLowerCase(), USDG) as { token: string; symbol: string; decimals: number }[]
  const candidates = [...staples, ...traded.filter((t) => t.token !== WETH.toLowerCase() && t.token !== USDG)]

  const balances = await Promise.all(
    candidates.map((c) =>
      chainClient
        .readContract({ address: c.token as Address, abi: erc20Abi, functionName: 'balanceOf', args: [key as Address] })
        .catch(() => 0n),
    ),
  )

  const holdings: Holding[] = []
  let total = 0n
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    const bal = balances[i]!
    if (bal <= 0n) continue
    let realizable: bigint | null = null
    let markEth: number | null = null
    if (c.token === WETH.toLowerCase()) {
      realizable = bal
      markEth = Number(bal) / 1e18
    } else {
      try {
        const r = await bestFill(c.token, 'sell', bal, { skipExit: true })
        realizable = r.amountIn === bal ? r.amountOut : null
        markEth = r.spotRaw > 0 ? (Number(bal) * r.spotRaw) / 1e18 : null
      } catch {
        realizable = null
      }
    }
    if (realizable !== null) total += realizable
    holdings.push({
      token: c.token,
      symbol: c.symbol,
      decimals: c.decimals,
      balance: bal.toString(),
      realizableWei: realizable?.toString() ?? null,
      markEth,
    })
  }
  holdings.sort((a, b) => Number(BigInt(b.realizableWei ?? '0') - BigInt(a.realizableWei ?? '0')))

  const value: WalletHoldings = { address: key, ethWei: ethWei.toString(), holdings, totalRealizableWei: total.toString(), fetchedAt: Date.now() }
  cache.set(key, { at: Date.now(), value })
  return value
}

export interface LpPosition {
  tokenId: string
  pool: string | null
  token0: string
  token1: string
  symbol0: string
  symbol1: string
  fee: number
  tickLower: number
  tickUpper: number
  currentTick: number | null
  inRange: boolean
  liquidity: string
  amount0: string
  amount1: string
  owed0: string
  owed1: string
  /** Position value at the pool's mid price, in the pool's quote units (human). */
  valueQuote: number | null
  quoteSymbol: string | null
}

/** Uniswap v3 LP NFTs held by the wallet, with live amounts and range status. */
export async function walletLpPositions(address: string): Promise<LpPosition[]> {
  const owner = address.toLowerCase() as Address
  const nfpm = { address: UNISWAP.positionManager, abi: nfpmAbi } as const
  const count = Number(await chainClient.readContract({ ...nfpm, functionName: 'balanceOf', args: [owner] }))
  const ids = await Promise.all(
    Array.from({ length: Math.min(count, 25) }, (_, i) =>
      chainClient.readContract({ ...nfpm, functionName: 'tokenOfOwnerByIndex', args: [owner, BigInt(i)] }),
    ),
  )
  const out: LpPosition[] = []
  for (const id of ids) {
    const p = await chainClient.readContract({ ...nfpm, functionName: 'positions', args: [id] })
    const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , owed0, owed1] = p
    if (liquidity === 0n && owed0 === 0n && owed1 === 0n) continue
    const poolRow = db
      .prepare(
        `SELECT p.address, p.base_is_token0, COALESCE(p.quote_symbol,'WETH') AS quote_symbol,
                t0.symbol AS s0, t1.symbol AS s1, t0.decimals AS d0, t1.decimals AS d1
         FROM pools p JOIN tokens t0 ON t0.address = p.token0 JOIN tokens t1 ON t1.address = p.token1
         WHERE p.version = 3 AND p.token0 = ? AND p.token1 = ? AND p.fee = ?`,
      )
      .get(token0.toLowerCase(), token1.toLowerCase(), fee) as
      | { address: string; base_is_token0: number | null; quote_symbol: string; s0: string; s1: string; d0: number; d1: number }
      | undefined

    let currentTick: number | null = null
    let amount0 = 0n
    let amount1 = 0n
    let valueQuote: number | null = null
    if (poolRow) {
      try {
        const snap = await readPoolState(chainClient, db, poolRow.address)
        currentTick = snap.state.tick
        const amts = getAmountsForLiquidity(snap.state.sqrtPriceX96, getSqrtRatioAtTick(tickLower), getSqrtRatioAtTick(tickUpper), liquidity)
        amount0 = amts.amount0
        amount1 = amts.amount1
        const praw = (Number(snap.state.sqrtPriceX96) / 2 ** 96) ** 2 // token1 per token0, raw
        if (poolRow.base_is_token0 !== null) {
          const quoteIsToken1 = poolRow.base_is_token0 === 1
          const qd = quoteIsToken1 ? poolRow.d1 : poolRow.d0
          const raw = quoteIsToken1 ? Number(amount1) + Number(amount0) * praw : Number(amount0) + Number(amount1) / praw
          valueQuote = raw / 10 ** qd
        }
      } catch {
        // pool unreadable right now; amounts stay zero, range unknown
      }
    }
    out.push({
      tokenId: id.toString(),
      pool: poolRow?.address ?? null,
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      symbol0: poolRow?.s0 ?? token0.slice(0, 6),
      symbol1: poolRow?.s1 ?? token1.slice(0, 6),
      fee,
      tickLower,
      tickUpper,
      currentTick,
      inRange: currentTick !== null && tickLower <= currentTick && currentTick < tickUpper,
      liquidity: liquidity.toString(),
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      owed0: owed0.toString(),
      owed1: owed1.toString(),
      valueQuote,
      quoteSymbol: poolRow?.base_is_token0 !== null && poolRow ? poolRow.quote_symbol : null,
    })
  }
  return out
}
