'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { erc20Abi, erc20WriteAbi } from '@paperhands/chain'
import { maxUint256, type Address } from 'viem'
import { useAccount, useBalance, useConnect, useReadContract, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { formatBps, formatPrice, formatQty, formatUsd } from '@/lib/format'
import { useMode } from '@/lib/mode'
import { useSolana, waitForSignature } from '@/lib/solana'
import { solBalanceLamports, splBalance } from '@/lib/solbalance'
import { BSC_SPENDER, EXPLORER, NATIVE, type XQuote } from '@/lib/x/types'

interface Props {
  chain: 'sol' | 'bsc'
  token: { address: string; symbol: string; decimals: number }
  nativeUsd: number | null
}

const SLIPPAGE_BPS = 100
const BSC_ID = 56

function shortError(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? 'failed'
  return m.split('\n')[0]!.slice(0, 140)
}

/**
 * One order sheet for Solana and BNB Chain: the same honest rows as Robinhood
 * Chain (spot vs fill, impact, sold right back, route + who quoted it) and
 * real execution signed by the user's own wallet — Phantom on Solana, the
 * injected EVM wallet on BNB Chain. Nothing is custodied.
 */
export default function XTicket({ chain, token, nativeUsd }: Props) {
  const native = NATIVE[chain]
  const { mode } = useMode()
  const qc = useQueryClient()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [nativeIn, setNativeIn] = useState(chain === 'sol' ? '0.1' : '0.05')
  const [sellPct, setSellPct] = useState(50)
  const [quote, setQuote] = useState<(XQuote & { error?: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<'idle' | 'approving' | 'building' | 'signing' | 'confirming'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txState, setTxState] = useState<'pending' | 'confirmed' | 'failed' | null>(null)
  const seq = useRef(0)

  // --- wallets -------------------------------------------------------------
  const sol = useSolana()
  const evm = useAccount()
  const { connect, connectors } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const approve = useWriteContract()
  const send = useSendTransaction()
  const evmReceipt = useWaitForTransactionReceipt({ hash: send.data, chainId: BSC_ID })
  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data, chainId: BSC_ID })

  const walletAddress = chain === 'sol' ? sol.publicKey : (evm.address ?? null)
  const connected = Boolean(walletAddress)

  // --- balances ------------------------------------------------------------
  const bnb = useBalance({ address: evm.address, chainId: BSC_ID, query: { enabled: chain === 'bsc' && Boolean(evm.address), refetchInterval: 15_000 } })
  const bscToken = useReadContract({
    address: token.address as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: evm.address ? [evm.address] : undefined,
    chainId: BSC_ID,
    query: { enabled: chain === 'bsc' && Boolean(evm.address), refetchInterval: 15_000 },
  })
  const spender = quote ? BSC_SPENDER[quote.route.source === 'kyberswap' ? 'kyberswap' : 'engine'] : BSC_SPENDER.engine
  const allowance = useReadContract({
    address: token.address as Address,
    abi: erc20WriteAbi,
    functionName: 'allowance',
    args: evm.address ? [evm.address, spender] : undefined,
    chainId: BSC_ID,
    query: { enabled: chain === 'bsc' && Boolean(evm.address) && side === 'sell' },
  })
  const solBal = useQuery({
    queryKey: ['solbal', sol.publicKey, token.address],
    queryFn: async () => {
      const [lamports, tokenRaw] = await Promise.all([solBalanceLamports(sol.publicKey!), splBalance(sol.publicKey!, token.address)])
      return { lamports, tokenRaw }
    },
    enabled: chain === 'sol' && Boolean(sol.publicKey),
    refetchInterval: 20_000,
  })

  const nativeBalance: bigint | null = chain === 'sol' ? (solBal.data?.lamports ?? null) : (bnb.data?.value ?? null)
  const held: bigint = chain === 'sol' ? (solBal.data?.tokenRaw ?? 0n) : ((bscToken.data as bigint | undefined) ?? 0n)

  // --- quoting -------------------------------------------------------------
  const rawAmount = useCallback((): bigint => {
    if (side === 'buy') {
      const v = Number.parseFloat(nativeIn)
      if (!Number.isFinite(v) || v <= 0) return 0n
      return BigInt(Math.round(v * 1e6)) * 10n ** BigInt(native.decimals - 6)
    }
    return (held * BigInt(sellPct)) / 100n
  }, [side, nativeIn, sellPct, held, native.decimals])

  const fetchQuote = useCallback(async () => {
    const amount = rawAmount()
    if (amount <= 0n) {
      setQuote(null)
      return
    }
    const mySeq = ++seq.current
    try {
      const res = await fetch(`/api/v1/xquote?chain=${chain}&token=${token.address}&side=${side}&amount=${amount}`)
      const q = (await res.json()) as XQuote & { error?: string }
      if (seq.current !== mySeq) return
      if (q.error) setError(q.error)
      else {
        setError(null)
        setQuote(q)
      }
    } catch {
      if (seq.current === mySeq) setError('Quote failed — retrying.')
    }
  }, [chain, token.address, side, rawAmount])

  useEffect(() => {
    setError(null)
    const t = setTimeout(fetchQuote, 350)
    const i = setInterval(fetchQuote, 12_000)
    return () => {
      clearTimeout(t)
      clearInterval(i)
    }
  }, [fetchQuote])

  useEffect(() => {
    if (approveReceipt.isSuccess) {
      setStage('idle')
      allowance.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt.isSuccess])
  useEffect(() => {
    if (evmReceipt.isSuccess) {
      setStage('idle')
      setTxState('confirmed')
      bnb.refetch()
      bscToken.refetch()
    }
    if (evmReceipt.isError) {
      setStage('idle')
      setTxState('failed')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evmReceipt.isSuccess, evmReceipt.isError])

  const amount = rawAmount()
  const needsApproval = chain === 'bsc' && side === 'sell' && ((allowance.data as bigint | undefined) ?? 0n) < amount
  const wrongChain = chain === 'bsc' && evm.isConnected && evm.chainId !== BSC_ID
  const blocked = Boolean(quote && (quote.fillRatio < 0.999999 || !quote.executable))
  const busy = stage !== 'idle'

  async function onConnect() {
    setError(null)
    try {
      if (chain === 'sol') await sol.connect()
      else {
        const c = connectors.find((x) => x.id === 'injected') ?? connectors[0]
        if (c) connect({ connector: c })
      }
    } catch (e) {
      setError(shortError(e))
    }
  }

  async function onApprove() {
    if (!evm.address) return
    setStage('approving')
    setError(null)
    try {
      if (wrongChain) await switchChainAsync({ chainId: BSC_ID })
      await approve.writeContractAsync({ address: token.address as Address, abi: erc20WriteAbi, functionName: 'approve', args: [spender, maxUint256], chainId: BSC_ID })
    } catch (e) {
      setStage('idle')
      setError(shortError(e))
    }
  }

  async function onTrade() {
    if (!quote || !walletAddress) return
    setError(null)
    setTxHash(null)
    setTxState(null)
    try {
      // Refresh so the wallet signs the freshest fill, then build for this wallet.
      setStage('building')
      const fresh = (await (await fetch(`/api/v1/xquote?chain=${chain}&token=${token.address}&side=${side}&amount=${amount}`)).json()) as XQuote & { error?: string }
      if (fresh.error) throw new Error(fresh.error)
      setQuote(fresh)
      const built = (await (
        await fetch('/api/v1/xtx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quote: fresh, user: walletAddress, slippageBps: SLIPPAGE_BPS }) })
      ).json()) as { error?: string; transaction?: string; to?: Address; data?: `0x${string}`; value?: string }
      if (built.error) throw new Error(built.error)
      setStage('signing')
      if (chain === 'sol') {
        const sig = await sol.signAndSend(built.transaction!)
        setTxHash(sig)
        setTxState('pending')
        setStage('confirming')
        const s = await waitForSignature(sig)
        setTxState(s === 'confirmed' ? 'confirmed' : s === 'failed' ? 'failed' : 'pending')
        setStage('idle')
        qc.invalidateQueries({ queryKey: ['solbal'] })
      } else {
        if (wrongChain) await switchChainAsync({ chainId: BSC_ID })
        const hash = await send.sendTransactionAsync({ to: built.to!, data: built.data!, value: BigInt(built.value ?? '0'), chainId: BSC_ID })
        setTxHash(hash)
        setTxState('pending')
        setStage('confirming')
      }
    } catch (e) {
      setStage('idle')
      setError(shortError(e))
    }
  }

  const usd = (nativeRaw: bigint) => (nativeUsd ? formatUsd((Number(nativeRaw) / 10 ** native.decimals) * nativeUsd) : null)
  const retention = quote?.retention ?? null
  const source = quote?.route.source
  const sourceLabel = source === 'engine' ? 'our engine · exact' : source === 'jupiter' ? 'Jupiter' : source === 'kyberswap' ? 'KyberSwap' : ''

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="label">Order · {native.symbol}</span>
        {mode === 'real' ? <span className="pill pill-pen">Real · you sign</span> : <span className="pill">Live quote</span>}
      </div>

      <div className="seg mb-4 w-full" role="tablist">
        {(['buy', 'sell'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)} className="flex-1" style={side === s ? { color: s === 'buy' ? 'var(--up)' : 'var(--down)' } : undefined}>
            {s === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      {side === 'buy' ? (
        <div>
          <label className="label mb-1.5 block" htmlFor="x-native">
            Spend{nativeBalance !== null ? ` · wallet ${formatQty(nativeBalance, native.decimals)} ${native.symbol}` : ''}
          </label>
          <div className="relative">
            <input id="x-native" type="text" inputMode="decimal" value={nativeIn} onChange={(e) => setNativeIn(e.target.value)} className="field num pr-16" />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-muted">{native.symbol}</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {(chain === 'sol' ? ['0.05', '0.1', '0.5', '1'] : ['0.02', '0.05', '0.1', '0.5']).map((p) => (
              <button key={p} onClick={() => setNativeIn(p)} className={`chip h-8 px-3 ${nativeIn === p ? 'chip-active' : ''}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <label className="label mb-1.5 block" htmlFor="x-pct">
            Sell {sellPct}% of {connected ? formatQty(held, token.decimals) : '—'} {token.symbol}
          </label>
          <input id="x-pct" type="range" min={1} max={100} value={sellPct} onChange={(e) => setSellPct(Number(e.target.value))} className="w-full accent-[var(--down)]" />
          <div className="mt-1 flex gap-1.5">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} onClick={() => setSellPct(p)} className={`chip h-8 px-3 ${sellPct === p ? 'chip-active' : ''}`}>
                {p}%
              </button>
            ))}
          </div>
          {!connected && <p className="mt-2 text-[13px] text-muted">Connect a wallet to size a sell from your balance.</p>}
          {connected && held === 0n && <p className="mt-2 text-[13px] text-down">This wallet holds no {token.symbol}.</p>}
        </div>
      )}

      <div className="mt-5 space-y-2 border-t border-line pt-4 text-[13.5px]">
        {quote ? (
          <>
            <Row label={quote.route.legs.length > 1 ? `Route · ${quote.route.legs.length} legs` : 'Route'} value={quote.route.label} valueClass="text-pen" mono={false} />
            <Row label="Quoted by" value={sourceLabel} valueClass={quote.exact ? 'text-up' : 'text-muted'} mono={false} />
            {quote.spotPrice !== null && <Row label="Spot" value={`${formatPrice(quote.spotPrice)} ${native.symbol}`} />}
            {quote.execPrice !== null && <Row label="Your fill" value={`${formatPrice(quote.execPrice)} ${native.symbol}`} />}
            {quote.priceImpactBps !== null && (
              <Row
                label={quote.exact ? 'Price impact' : 'Price impact · est.'}
                value={formatBps(quote.priceImpactBps)}
                valueClass={quote.priceImpactBps > 300 ? 'text-down font-semibold' : quote.priceImpactBps > 75 ? 'text-warn' : ''}
              />
            )}
            {quote.feeBps !== null && <Row label="LP fee" value={formatBps(quote.feeBps)} />}
            <Row
              label="You receive"
              value={side === 'buy' ? `${formatQty(BigInt(quote.amountOut), token.decimals)} ${token.symbol}` : `${formatQty(BigInt(quote.amountOut), native.decimals)} ${native.symbol}${usd(BigInt(quote.amountOut)) ? ` · ${usd(BigInt(quote.amountOut))}` : ''}`}
              strong
            />
            <Row
              label="Minimum · 1% slippage"
              value={side === 'buy' ? `${formatQty((BigInt(quote.amountOut) * 9900n) / 10_000n, token.decimals)} ${token.symbol}` : `${formatQty((BigInt(quote.amountOut) * 9900n) / 10_000n, native.decimals)} ${native.symbol}`}
              valueClass="text-muted"
            />
            {side === 'buy' && quote.instantExit && retention !== null && (
              <Row label="Sold right back" value={`${formatQty(BigInt(quote.instantExit), native.decimals)} ${native.symbol} · ${(retention * 100).toFixed(1)}%`} valueClass={retention < 0.9 ? 'text-down' : 'text-muted'} />
            )}
            {quote.gasUsd !== null && quote.gasUsd !== undefined && <Row label="Gas · est." value={formatUsd(quote.gasUsd)} valueClass="text-muted" />}
            {quote.alt && (
              <p className="rounded-xl bg-bg-2 px-3 py-2 text-[12.5px] text-muted">
                Runner-up: {quote.alt.source === 'engine' ? 'our engine' : quote.alt.source === 'kyberswap' ? 'KyberSwap' : 'Jupiter'} would give{' '}
                <span className="num">{formatQty(BigInt(quote.alt.amountOut), side === 'buy' ? token.decimals : native.decimals)}</span> via {quote.alt.label}. We route to the better fill.
              </p>
            )}
            {!quote.executable && <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">This route can&rsquo;t be signed in one transaction at this size.</p>}
            {quote.fillRatio < 0.999999 && <p className="rounded-xl bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">The visible liquidity can&rsquo;t absorb this size — only {(quote.fillRatio * 100).toFixed(1)}% fills.</p>}
          </>
        ) : (
          <p className="text-faint">Enter a size to see the exact fill.</p>
        )}
        {error && <p className="rounded-xl bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
        {txHash && (
          <p className={`rounded-xl px-3 py-2 text-[13px] ${txState === 'failed' ? 'bg-down-soft text-down' : 'bg-up-soft text-up'}`}>
            {txState === 'confirmed' ? 'Confirmed ✓' : txState === 'failed' ? 'Failed on-chain' : 'Submitted…'}{' '}
            <a className="underline" href={EXPLORER[chain].tx(txHash)} target="_blank" rel="noreferrer">
              view transaction
            </a>
          </p>
        )}
      </div>

      {mode !== 'real' ? (
        <p className="mt-5 rounded-xl bg-bg-2 px-3 py-2 text-center text-[13px] text-muted">
          Practice ledgers live on Robinhood Chain. Switch to <span className="font-semibold text-ink">Real</span> to trade {token.symbol} from your own wallet.
        </p>
      ) : !connected ? (
        <button className="btn btn-primary mt-5 w-full" onClick={onConnect} disabled={sol.connecting}>
          {chain === 'sol' ? (sol.available ? `Connect ${sol.walletName}` : 'Install Phantom to trade') : 'Connect wallet'}
        </button>
      ) : wrongChain && side === 'buy' ? (
        <button className="btn btn-ghost mt-5 w-full" onClick={() => switchChainAsync({ chainId: BSC_ID })}>
          Switch wallet to BNB Chain
        </button>
      ) : needsApproval ? (
        <button onClick={onApprove} disabled={busy || amount <= 0n} className="btn btn-pen mt-5 w-full">
          {busy ? 'Approving…' : `Approve ${token.symbol} for ${source === 'kyberswap' ? 'KyberSwap' : 'PancakeSwap'}`}
        </button>
      ) : (
        <button onClick={onTrade} disabled={busy || !quote || blocked || amount <= 0n} className={`btn mt-5 w-full ${side === 'buy' ? 'btn-primary' : 'btn-danger'}`}>
          {stage === 'building' ? 'Building…' : stage === 'signing' ? 'Confirm in wallet…' : stage === 'confirming' ? 'Confirming…' : side === 'buy' ? `Buy ${token.symbol}` : `Sell ${token.symbol}`}
        </button>
      )}
      <p className="mt-2 text-center text-[12px] text-faint">
        {chain === 'sol' ? 'Signed in your Solana wallet · routed by Jupiter across every Solana DEX' : 'Signed by your wallet · PancakeSwap v3 through our exact engine, or KyberSwap when it fills better'} · we never hold funds.
      </p>
    </div>
  )
}

function Row({ label, value, strong, valueClass, mono = true }: { label: string; value: string; strong?: boolean; valueClass?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={`${mono ? 'num' : ''} text-right ${strong ? 'font-semibold' : ''} ${valueClass ?? ''}`}>{value}</span>
    </div>
  )
}
