import * as anchor from '@coral-xyz/anchor'
import { Percentage } from '@orca-so/common-sdk'
import {
  IGNORE_CACHE,
  PoolUtil,
  PriceMath,
  TickUtil,
  TokenExtensionUtil,
  WhirlpoolContext,
  buildWhirlpoolClient,
  getAllPositionAccountsByOwner,
  increaseLiquidityQuoteByInputTokenWithParams,
  type WhirlpoolClient,
} from '@orca-so/whirlpools-sdk'
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import { sigmaFromGecko } from './lp'
import { SOL_MINT } from './sol'

/**
 * LP on Solana through Orca Whirlpools (concentrated liquidity, the v3
 * idea). Transactions are built here for the user's own pubkey — the only
 * server-side signature is the throwaway position-mint keypair — and signed
 * in Phantom. Deposits are sized in SOL as total position value, like the
 * Robinhood Chain and BSC planners.
 */
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'
const { BN } = anchor

let clientCache: { client: WhirlpoolClient; ctx: WhirlpoolContext } | null = null
function orca(): { client: WhirlpoolClient; ctx: WhirlpoolContext } {
  if (clientCache) return clientCache
  const connection = new Connection(RPC, 'confirmed')
  // Build-only wallet: the SDK reads publicKey to derive accounts; it never signs here.
  const wallet = { publicKey: PublicKey.default, signTransaction: async <T>(t: T) => t, signAllTransactions: async <T>(t: T) => t }
  const ctx = WhirlpoolContext.from(connection, wallet as never)
  clientCache = { client: buildWhirlpoolClient(ctx), ctx }
  return clientCache
}

export interface OrcaPoolChoice {
  address: string
  name: string
  tickSpacing: number
  feeRate: number
  tvlUsd: number
  price: number
  volume24Usd: number
  fees24Usd: number
  solIsA: boolean
  tokenA: { mint: string; symbol: string; decimals: number }
  tokenB: { mint: string; symbol: string; decimals: number }
}

interface OrcaApiPool {
  address: string
  tickSpacing: number
  feeRate: number
  tvlUsdc: string
  price: string
  tokenA: { address: string; symbol: string; decimals: number }
  tokenB: { address: string; symbol: string; decimals: number }
  stats?: { '24h'?: { volume?: string; fees?: string } }
}

/** Orca pools pairing the token with SOL, deepest first. */
export async function orcaPoolsFor(mint: string): Promise<OrcaPoolChoice[]> {
  const res = await fetch(`https://api.orca.so/v2/solana/pools?tokensBothOf=${mint},${SOL_MINT}&size=12`, { headers: { accept: 'application/json' }, cache: 'no-store' })
  if (!res.ok) throw new Error(`orca ${res.status}`)
  const { data } = (await res.json()) as { data: OrcaApiPool[] }
  return data
    .filter((p) => p.tokenA.address === SOL_MINT || p.tokenB.address === SOL_MINT)
    .map((p) => ({
      address: p.address,
      name: `${p.tokenA.symbol}/${p.tokenB.symbol}`,
      tickSpacing: p.tickSpacing,
      feeRate: p.feeRate,
      tvlUsd: Number(p.tvlUsdc),
      price: Number(p.price),
      volume24Usd: Number(p.stats?.['24h']?.volume ?? 0),
      fees24Usd: Number(p.stats?.['24h']?.fees ?? 0),
      solIsA: p.tokenA.address === SOL_MINT,
      tokenA: { mint: p.tokenA.address, symbol: p.tokenA.symbol, decimals: p.tokenA.decimals },
      tokenB: { mint: p.tokenB.address, symbol: p.tokenB.symbol, decimals: p.tokenB.decimals },
    }))
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
}

const clamp = (v: number) => Math.min(300, Math.max(3, Math.round(v)))
export async function orcaRanges(pool: string): Promise<{ sigma24Pct: number | null; ranges: { label: string; pct: number; note: string }[] }> {
  const sigma = await sigmaFromGecko('sol', pool)
  const s = sigma ?? 30
  return {
    sigma24Pct: sigma,
    ranges: [
      { label: 'tight', pct: clamp(s), note: 'Max fee capture; expect to leave range within a day.' },
      { label: 'balanced', pct: clamp(s * 2), note: 'Covers a typical day.' },
      { label: 'wide', pct: clamp(s * 4), note: 'Survives a violent day; lowest fee density.' },
    ],
  }
}

export interface OrcaOpenPlan {
  pool: string
  positionMint: string
  tickLower: number
  tickUpper: number
  currentTick: number
  solIsA: boolean
  /** Estimated deposit per side, raw units. */
  estA: string
  estB: string
  maxA: string
  maxB: string
  /** Base64 VersionedTransaction, signed by the position mint; the wallet adds its signature and sends. */
  transaction: string
}

function serialize(tx: Transaction | VersionedTransaction, signers: Keypair[]): string {
  if (tx instanceof VersionedTransaction) {
    if (signers.length) tx.sign(signers)
    return Buffer.from(tx.serialize()).toString('base64')
  }
  if (signers.length) tx.partialSign(...signers)
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
}

/** Open a position worth `solLamports` in total at ±rangePct around the current price. */
export async function planOrcaOpen(poolAddress: string, rangePct: number, solLamports: bigint, owner: string): Promise<OrcaOpenPlan> {
  const { client, ctx } = orca()
  const user = new PublicKey(owner)
  const pool = await client.getPool(new PublicKey(poolAddress), IGNORE_CACHE)
  const d = pool.getData()
  const A = pool.getTokenAInfo()
  const B = pool.getTokenBInfo()
  const solIsA = A.mint.toBase58() === SOL_MINT
  if (!solIsA && B.mint.toBase58() !== SOL_MINT) throw new Error('only SOL-paired pools can be opened with a SOL deposit')
  const price = PriceMath.sqrtPriceX64ToPrice(d.sqrtPrice, A.decimals, B.decimals)
  const r = rangePct / 100
  const tickLower = TickUtil.getInitializableTickIndex(PriceMath.priceToTickIndex(price.mul(1 - r), A.decimals, B.decimals), d.tickSpacing)
  const tickUpper = Math.max(TickUtil.getInitializableTickIndex(PriceMath.priceToTickIndex(price.mul(1 + r), A.decimals, B.decimals), d.tickSpacing), tickLower + d.tickSpacing)
  const ext = await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, d, IGNORE_CACHE)
  const solMint = solIsA ? A.mint : B.mint
  const quoteFor = (lamports: bigint) =>
    increaseLiquidityQuoteByInputTokenWithParams({
      tokenMintA: d.tokenMintA,
      tokenMintB: d.tokenMintB,
      sqrtPrice: d.sqrtPrice,
      tickCurrentIndex: d.tickCurrentIndex,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
      inputTokenMint: solMint,
      inputTokenAmount: new BN(lamports.toString()),
      slippageTolerance: Percentage.fromFraction(1, 100),
      tokenExtensionCtx: ext,
    })
  // First pass sizes the SOL side; scale so SOL side + other side (in SOL) equals the deposit.
  const first = quoteFor(solLamports)
  const p = price.toNumber() // B per A, human
  const solSide = Number(solIsA ? first.tokenEstA.toString() : first.tokenEstB.toString()) / 1e9
  const otherRaw = Number(solIsA ? first.tokenEstB.toString() : first.tokenEstA.toString())
  const otherInSol = solIsA ? (otherRaw / 10 ** B.decimals) / p : (otherRaw / 10 ** A.decimals) * p
  const total = solSide + otherInSol
  const scaled = total > 0 ? BigInt(Math.floor(Number(solLamports) * (solSide / total))) : solLamports
  const quote = quoteFor(scaled > 0n ? scaled : solLamports)
  if (quote.liquidityAmount.isZero()) throw new Error('range holds no value at the current price')
  // v2 "by token amounts": the program derives liquidity from the maxima and
  // refuses to execute if the price left this band (±1% ⇒ ±0.5% on √price).
  const liquidityInput = {
    tokenMaxA: quote.tokenMaxA,
    tokenMaxB: quote.tokenMaxB,
    minSqrtPrice: d.sqrtPrice.muln(994_987).divn(1_000_000),
    maxSqrtPrice: d.sqrtPrice.muln(1_004_988).divn(1_000_000),
  }
  const { positionMint, tx } = await pool.openPosition(tickLower, tickUpper, liquidityInput, user, user)
  const built = await tx.build()
  return {
    pool: poolAddress,
    positionMint: positionMint.toBase58(),
    tickLower,
    tickUpper,
    currentTick: d.tickCurrentIndex,
    solIsA,
    estA: quote.tokenEstA.toString(),
    estB: quote.tokenEstB.toString(),
    maxA: quote.tokenMaxA.toString(),
    maxB: quote.tokenMaxB.toString(),
    transaction: serialize(built.transaction, built.signers as Keypair[]),
  }
}

export interface OrcaPosition {
  address: string
  positionMint: string
  pool: string
  name: string
  tokenA: { mint: string; symbol: string; decimals: number }
  tokenB: { mint: string; symbol: string; decimals: number }
  tickLower: number
  tickUpper: number
  currentTick: number
  inRange: boolean
  liquidity: string
  amountA: string
  amountB: string
  feeOwedA: string
  feeOwedB: string
  /** Position value at mid, in SOL (null when neither side is SOL). */
  valueSol: number | null
  feeRate: number
}

/** The wallet's Orca positions with live amounts and range status. */
export async function orcaPositions(owner: string): Promise<OrcaPosition[]> {
  const { client, ctx } = orca()
  const user = new PublicKey(owner)
  const found = await getAllPositionAccountsByOwner({ ctx, owner: user })
  const entries = [...found.positions.entries(), ...found.positionsWithTokenExtensions.entries()].slice(0, 25)
  const out: OrcaPosition[] = []
  const poolCache = new Map<string, Awaited<ReturnType<WhirlpoolClient['getPool']>>>()
  for (const [address, pos] of entries) {
    const poolKey = pos.whirlpool.toBase58()
    let pool = poolCache.get(poolKey)
    if (!pool) {
      pool = await client.getPool(pos.whirlpool, IGNORE_CACHE)
      poolCache.set(poolKey, pool)
    }
    const d = pool.getData()
    const A = pool.getTokenAInfo()
    const B = pool.getTokenBInfo()
    const amounts = PoolUtil.getTokenAmountsFromLiquidity(pos.liquidity, d.sqrtPrice, PriceMath.tickIndexToSqrtPriceX64(pos.tickLowerIndex), PriceMath.tickIndexToSqrtPriceX64(pos.tickUpperIndex), false)
    const price = PriceMath.sqrtPriceX64ToPrice(d.sqrtPrice, A.decimals, B.decimals).toNumber()
    const a = Number(amounts.tokenA.toString()) / 10 ** A.decimals
    const b = Number(amounts.tokenB.toString()) / 10 ** B.decimals
    const aMint = A.mint.toBase58()
    const bMint = B.mint.toBase58()
    const valueSol = aMint === SOL_MINT ? a + b / price : bMint === SOL_MINT ? b + a * price : null
    const sym = (mint: string) => (mint === SOL_MINT ? 'SOL' : mint.slice(0, 4) + '…')
    out.push({
      address,
      positionMint: pos.positionMint.toBase58(),
      pool: poolKey,
      name: `${sym(aMint)}/${sym(bMint)}`,
      tokenA: { mint: aMint, symbol: sym(aMint), decimals: A.decimals },
      tokenB: { mint: bMint, symbol: sym(bMint), decimals: B.decimals },
      tickLower: pos.tickLowerIndex,
      tickUpper: pos.tickUpperIndex,
      currentTick: d.tickCurrentIndex,
      inRange: pos.tickLowerIndex <= d.tickCurrentIndex && d.tickCurrentIndex < pos.tickUpperIndex,
      liquidity: pos.liquidity.toString(),
      amountA: amounts.tokenA.toString(),
      amountB: amounts.tokenB.toString(),
      feeOwedA: pos.feeOwedA.toString(),
      feeOwedB: pos.feeOwedB.toString(),
      valueSol,
      feeRate: d.feeRate,
    })
  }
  return out
}

/** Current in-range liquidity and fee for a Whirlpool, plus SOL/USD for unit conversion. */
export async function orcaPoolLiquidity(poolAddress: string): Promise<{ liquidityRaw: number; decimalsA: number; decimalsB: number; feeRate: number; solUsd: number }> {
  const { client } = orca()
  const pool = await client.getPool(new PublicKey(poolAddress), IGNORE_CACHE)
  const d = pool.getData()
  const solUsd = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, { cache: 'no-store' })
    .then((r) => r.json() as Promise<Record<string, { usdPrice: number }>>)
    .then((j) => j[SOL_MINT]?.usdPrice ?? 1)
    .catch(() => 1)
  return { liquidityRaw: Number(d.liquidity.toString()), decimalsA: pool.getTokenAInfo().decimals, decimalsB: pool.getTokenBInfo().decimals, feeRate: d.feeRate, solUsd }
}

/** Close a position: remove all liquidity, collect fees and rewards, burn the NFT. One or more transactions to sign in order. */
export async function planOrcaClose(positionAddress: string, owner: string): Promise<{ transactions: string[] }> {
  const { client, ctx } = orca()
  const user = new PublicKey(owner)
  const position = await client.getPosition(new PublicKey(positionAddress), IGNORE_CACHE)
  const pool = await client.getPool(position.getData().whirlpool, IGNORE_CACHE)
  const builders = await pool.closePosition(new PublicKey(positionAddress), Percentage.fromFraction(1, 100), user, user, user)
  const list = Array.isArray(builders) ? builders : [builders]
  const transactions: string[] = []
  for (const b of list) {
    const built = await b.build()
    transactions.push(serialize(built.transaction, built.signers as Keypair[]))
  }
  void ctx
  return { transactions }
}
