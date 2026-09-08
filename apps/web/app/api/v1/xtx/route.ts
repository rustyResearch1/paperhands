import { NextRequest, NextResponse } from 'next/server'
import { encodeFunctionData, type Address } from 'viem'
import { buildSwap, minOutFrom, type ExecLeg } from '@/lib/execute'
import { limitHeaders, rateLimit } from '@/lib/ratelimit'
import { PANCAKE, WBNB, kyberBuild } from '@/lib/x/bsc'
import { jupSwapTx, type JupQuote } from '@/lib/x/sol'
import type { XQuote } from '@/lib/x/types'

export const maxDuration = 30

/**
 * POST /api/v1/xtx  { quote: XQuote, user: <address|pubkey>, slippageBps? }
 * Turns a quote into the transaction the user's wallet signs. Nothing is
 * signed or sent here — Solana returns a base64 VersionedTransaction for
 * Phantom, EVM chains return {to, data, value}.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 30)
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: limitHeaders(rl) })
  let body: { quote?: XQuote; user?: string; slippageBps?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'json body required' }, { status: 400, headers: limitHeaders(rl) })
  }
  const { quote, user } = body
  const slippageBps = Math.min(500, Math.max(10, Number(body.slippageBps ?? 100)))
  if (!quote || !user) return NextResponse.json({ error: 'quote and user are required' }, { status: 400, headers: limitHeaders(rl) })
  if (Date.now() - quote.quotedAt > 60_000) return NextResponse.json({ error: 'quote is stale — refresh it' }, { status: 409, headers: limitHeaders(rl) })
  const exec = quote.exec as { kind: string; quoteResponse?: JupQuote; routeSummary?: unknown; legs?: ExecLeg[] }
  try {
    if (quote.chain === 'sol' && exec.kind === 'jupiter' && exec.quoteResponse) {
      const tx = await jupSwapTx(exec.quoteResponse, user)
      return NextResponse.json({ chain: 'sol', kind: 'solana-versioned-tx', ...tx }, { headers: limitHeaders(rl) })
    }
    if (quote.chain === 'bsc' && exec.kind === 'kyber' && exec.routeSummary) {
      const tx = await kyberBuild(exec.routeSummary, user, user, slippageBps)
      return NextResponse.json({ chain: 'bsc', kind: 'evm-call', ...tx, approveTo: tx.to }, { headers: limitHeaders(rl) })
    }
    if (quote.chain === 'bsc' && exec.kind === 'pancake-v3' && exec.legs) {
      const tx = buildSwap({
        side: quote.side,
        legs: exec.legs,
        amountIn: BigInt(quote.amountIn),
        minOut: minOutFrom(BigInt(quote.amountOut), slippageBps),
        recipient: user as Address,
        router: PANCAKE.smartRouter,
        wrappedNative: WBNB,
      })
      const data = encodeFunctionData({ abi: tx.abi, functionName: tx.functionName, args: tx.args as never })
      return NextResponse.json({ chain: 'bsc', kind: 'evm-call', to: tx.address, data, value: tx.value.toString(), approveTo: PANCAKE.smartRouter }, { headers: limitHeaders(rl) })
    }
    return NextResponse.json({ error: 'this quote has no server-built transaction (Robinhood Chain routes are built in the wallet flow)' }, { status: 400, headers: limitHeaders(rl) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502, headers: limitHeaders(rl) })
  }
}
