import { NATIVE, type XQuote, type XToken } from './types'

/**
 * Solana through Jupiter — the aggregator every Solana DEX routes through
 * (Raydium, Orca, Meteora, pump.fun AMM, …). Keyless "lite" API. Honesty is
 * added on top: a reverse quote of the output is the real "sold right back".
 */
const JUP = process.env.JUPITER_API ?? 'https://lite-api.jup.ag'
export const SOL_MINT = NATIVE.sol.address

export interface JupQuote {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: string
  slippageBps: number
  priceImpactPct: string
  routePlan: { swapInfo: { ammKey: string; label: string; inputMint: string; outputMint: string; inAmount: string; outAmount: string; feeAmount: string; feeMint: string }; percent: number }[]
  contextSlot?: number
  timeTaken?: number
}

async function jup<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${JUP}${path}`, { ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) }, cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; errorCode?: string }
  if (!res.ok) throw new Error(body.error ?? `jupiter ${res.status}`)
  return body
}

export async function jupQuote(inputMint: string, outputMint: string, amount: bigint, slippageBps = 50): Promise<JupQuote> {
  const q = new URLSearchParams({ inputMint, outputMint, amount: amount.toString(), slippageBps: String(slippageBps), restrictIntermediateTokens: 'true' })
  return jup<JupQuote>(`/swap/v1/quote?${q}`)
}

/** The transaction the user signs in Phantom. Built for their pubkey; we never touch keys. */
export async function jupSwapTx(quoteResponse: JupQuote, userPublicKey: string): Promise<{ transaction: string; lastValidBlockHeight: number; computeUnitLimit?: number }> {
  const r = await jup<{ swapTransaction: string; lastValidBlockHeight: number; computeUnitLimit?: number; simulationError?: unknown }>(`/swap/v1/swap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: false }),
  })
  if (r.simulationError) throw new Error(`jupiter simulation: ${JSON.stringify(r.simulationError).slice(0, 160)}`)
  return { transaction: r.swapTransaction, lastValidBlockHeight: r.lastValidBlockHeight, computeUnitLimit: r.computeUnitLimit }
}

const tokenCache = new Map<string, { at: number; t: XToken }>()

export async function solToken(mint: string): Promise<XToken> {
  const hit = tokenCache.get(mint)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.t
  if (mint === SOL_MINT) {
    const t: XToken = { chain: 'sol', address: mint, symbol: 'SOL', name: 'Solana', decimals: 9 }
    tokenCache.set(mint, { at: Date.now(), t })
    return t
  }
  const rows = await jup<{ id: string; symbol: string; name: string; decimals: number; usdPrice?: number }[]>(`/tokens/v2/search?query=${encodeURIComponent(mint)}`)
  const r = rows.find((x) => x.id === mint) ?? rows[0]
  if (!r) throw new Error('unknown Solana token')
  const t: XToken = { chain: 'sol', address: r.id, symbol: r.symbol, name: r.name, decimals: r.decimals, priceUsd: r.usdPrice ?? null }
  tokenCache.set(mint, { at: Date.now(), t })
  return t
}

export async function solSearch(query: string): Promise<XToken[]> {
  const rows = await jup<{ id: string; symbol: string; name: string; decimals: number; usdPrice?: number; organicScore?: number; liquidity?: number }[]>(
    `/tokens/v2/search?query=${encodeURIComponent(query)}`,
  )
  return rows.slice(0, 12).map((r) => ({ chain: 'sol', address: r.id, symbol: r.symbol, name: r.name, decimals: r.decimals, priceUsd: r.usdPrice ?? null }))
}

const legLabel = (l: JupQuote['routePlan'][number]) => `${l.swapInfo.label}${l.percent < 100 ? ` ${l.percent}%` : ''}`

export async function solQuote(side: 'buy' | 'sell', token: string, amountIn: bigint, slippageBps = 50): Promise<XQuote> {
  const tokenIn = side === 'buy' ? SOL_MINT : token
  const tokenOut = side === 'buy' ? token : SOL_MINT
  const q = await jupQuote(tokenIn, tokenOut, amountIn, slippageBps)
  const out = BigInt(q.outAmount)
  const meta = await solToken(token).catch(() => null)
  const dec = meta?.decimals ?? 0
  // SOL per token, human units.
  const solPer = (lamports: bigint, units: bigint) => (units > 0n ? Number(lamports) / 1e9 / (Number(units) / 10 ** dec) : null)
  const execPrice = side === 'buy' ? solPer(amountIn, out) : solPer(out, amountIn)
  const impactPct = Number(q.priceImpactPct)
  // Jupiter's impact is total (fee-inclusive) — mid ≈ exec / (1 − impact).
  const spotPrice = execPrice !== null && Number.isFinite(impactPct) ? (side === 'buy' ? execPrice * (1 - impactPct) : execPrice / (1 - impactPct)) : null

  const quote: XQuote = {
    chain: 'sol',
    side,
    token,
    tokenIn,
    tokenOut,
    amountIn: q.inAmount,
    amountOut: q.outAmount,
    fillRatio: 1,
    priceImpactBps: Number.isFinite(impactPct) ? impactPct * 10_000 : null,
    feeBps: null,
    spotPrice,
    execPrice,
    route: { label: q.routePlan.map(legLabel).join(' → '), legs: q.routePlan.map(legLabel), source: 'jupiter' },
    exact: false,
    executable: true,
    gasUsd: null,
    exec: { kind: 'jupiter', quoteResponse: q },
    quotedAt: Date.now(),
  }
  if (side === 'buy' && out > 0n) {
    try {
      const back = await jupQuote(token, SOL_MINT, out, slippageBps)
      quote.instantExit = back.outAmount
      quote.retention = Number(BigInt(back.outAmount)) / Number(amountIn)
    } catch {
      // no reverse route: leave the line off rather than guess
    }
  }
  return quote
}
