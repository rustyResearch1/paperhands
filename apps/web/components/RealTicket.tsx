'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { UNISWAP, EXPLORER_URL, erc20Abi, erc20WriteAbi, permit2Abi } from '@paperhands/chain'
import { maxUint256, type Address } from 'viem'
import { useAccount, useBalance, useConnect, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { MAX_UINT160, PERMIT2_EXPIRY_SECONDS, buildRouteSwap, minOutFrom, routerFor, type ExecLeg } from '@/lib/execute'
import { formatBps, formatEth, formatPrice, formatQty } from '@/lib/format'

interface TicketQuote {
  side: 'buy' | 'sell'
  amountIn: string
  amountOut: string
  fillRatio: number
  exhaustedWindow: boolean
  priceImpactBps: number
  priceMovePct: number
  feeBps: number
  spotPrice: number
  execPrice: number
  instantExit?: string
  markInflation?: number
  route?: { label: string; twoLeg: boolean; hooked: boolean; exec: ExecLeg[]; executable: boolean }
  error?: string
}

interface Props {
  pool: string
  baseAddress: string
  baseSymbol: string
  baseDecimals: number
  stock?: boolean
}

const SLIPPAGE_BPS = 100

/**
 * Real order sheet: same exact quote as practice, restricted to routes one
 * wallet transaction can sign — hookless v3 through SwapRouter02, v4 through
 * the Universal Router. Sells need an allowance first: a plain ERC20 approve
 * for v3, or ERC20 → Permit2 plus a Permit2 grant to the router for v4.
 */
export default function RealTicket({ pool, baseAddress, baseSymbol, baseDecimals, stock }: Props) {
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors } = useConnect()
  const { switchChain } = useSwitchChain()
  const qc = useQueryClient()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [ethIn, setEthIn] = useState('0.1')
  const [sellPct, setSellPct] = useState(50)
  const [quote, setQuote] = useState<TicketQuote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<'idle' | 'approving' | 'swapping'>('idle')
  const seq = useRef(0)

  const ethBal = useBalance({ address, query: { enabled: Boolean(address), refetchInterval: 15_000 } })
  const tokenBal = useReadContract({
    address: baseAddress as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  })
  const sellQuery = { enabled: Boolean(address) && side === 'sell' }
  const allowanceV3 = useReadContract({
    address: baseAddress as Address,
    abi: erc20WriteAbi,
    functionName: 'allowance',
    args: address ? [address, UNISWAP.swapRouter02] : undefined,
    query: sellQuery,
  })
  const allowanceP2 = useReadContract({
    address: baseAddress as Address,
    abi: erc20WriteAbi,
    functionName: 'allowance',
    args: address ? [address, UNISWAP.permit2] : undefined,
    query: sellQuery,
  })
  const permit2 = useReadContract({
    address: UNISWAP.permit2,
    abi: permit2Abi,
    functionName: 'allowance',
    args: address ? [address, baseAddress as Address, UNISWAP.universalRouter] : undefined,
    query: sellQuery,
  })
  const held = (tokenBal.data as bigint | undefined) ?? 0n

  const rawAmount = useCallback((): bigint => {
    if (side === 'buy') {
      const v = Number.parseFloat(ethIn)
      if (!Number.isFinite(v) || v <= 0) return 0n
      return BigInt(Math.round(v * 1e6)) * 10n ** 12n
    }
    return (held * BigInt(sellPct)) / 100n
  }, [side, ethIn, sellPct, held])

  useEffect(() => {
    const amount = rawAmount()
    setError(null)
    if (amount <= 0n) {
      setQuote(null)
      return
    }
    const mySeq = ++seq.current
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/quote?pool=${pool}&side=${side}&amount=${amount}&real=1`)
        const q = await res.json()
        if (seq.current !== mySeq) return
        if (q.error) setError(q.error)
        else setQuote(q)
      } catch {
        if (seq.current === mySeq) setError('Quote failed — retrying as you type.')
      }
    }, 350)
    return () => clearTimeout(t)
  }, [pool, side, rawAmount])

  const approve = useWriteContract()
  const swap = useWriteContract()
  const approveRcpt = useWaitForTransactionReceipt({ hash: approve.data })
  const swapRcpt = useWaitForTransactionReceipt({ hash: swap.data })

  useEffect(() => {
    if (approveRcpt.isSuccess) {
      setStage('idle')
      allowanceV3.refetch()
      allowanceP2.refetch()
      permit2.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveRcpt.isSuccess])
  useEffect(() => {
    if (swapRcpt.isSuccess) {
      setStage('idle')
      ethBal.refetch()
      tokenBal.refetch()
      qc.invalidateQueries({ queryKey: ['holdings', address] })
    }
  }, [swapRcpt.isSuccess, address, qc, ethBal, tokenBal])

  const amount = rawAmount()
  const router = quote?.route ? routerFor(quote.route.exec) : null
  const nowSec = Math.floor(Date.now() / 1000)
  const p2 = permit2.data as readonly [bigint, number, number] | undefined
  // Which allowance is missing for a sell, in the order they must be granted.
  const approvalStep: null | 'v3' | 'permit2-erc20' | 'permit2-router' =
    side !== 'sell' || amount <= 0n || !router
      ? null
      : router === 'v3'
        ? ((allowanceV3.data as bigint | undefined) ?? 0n) < amount
          ? 'v3'
          : null
        : ((allowanceP2.data as bigint | undefined) ?? 0n) < amount
          ? 'permit2-erc20'
          : !p2 || p2[0] < amount || p2[1] <= nowSec
            ? 'permit2-router'
            : null
  const needsApproval = approvalStep !== null
  const blocked = Boolean(quote && (quote.fillRatio < 1 || quote.exhaustedWindow || !quote.route?.executable))
  const wrongChain = isConnected && chainId !== 4663

  async function onApprove() {
    if (!approvalStep) return
    setStage('approving')
    setError(null)
    try {
      if (approvalStep === 'permit2-router') {
        await approve.writeContractAsync({
          address: UNISWAP.permit2,
          abi: permit2Abi,
          functionName: 'approve',
          args: [baseAddress as Address, UNISWAP.universalRouter, MAX_UINT160, nowSec + PERMIT2_EXPIRY_SECONDS],
        })
      } else {
        await approve.writeContractAsync({
          address: baseAddress as Address,
          abi: erc20WriteAbi,
          functionName: 'approve',
          args: [approvalStep === 'v3' ? UNISWAP.swapRouter02 : UNISWAP.permit2, maxUint256],
        })
      }
    } catch (e) {
      setStage('idle')
      setError((e as Error).message.split('\n')[0] ?? 'Approval rejected')
    }
  }

  async function onSwap() {
    if (!quote?.route || !address) return
    setStage('swapping')
    setError(null)
    try {
      const tx = buildRouteSwap({
        side,
        legs: quote.route.exec,
        amountIn: BigInt(quote.amountIn),
        minOut: minOutFrom(BigInt(quote.amountOut), SLIPPAGE_BPS),
        recipient: address,
      })
      await swap.writeContractAsync({ address: tx.address, abi: tx.abi, functionName: tx.functionName, args: tx.args, value: tx.value } as never)
    } catch (e) {
      setStage('idle')
      setError((e as Error).message.split('\n')[0] ?? 'Transaction rejected')
    }
  }

  if (!isConnected || !address) {
    const c = connectors.find((x) => x.id === 'injected') ?? connectors[0]
    return (
      <div className="card p-5 text-center">
        <div className="pill pill-pen mb-3">real mode</div>
        <p className="mb-4 text-muted">Connect a wallet to trade {baseSymbol} for real. Same exact quotes, signed by you.</p>
        <button className="btn btn-primary w-full" disabled={!c} onClick={() => c && connect({ connector: c })}>
          Connect wallet
        </button>
      </div>
    )
  }

  const busy = stage !== 'idle' || approve.isPending || swap.isPending || approveRcpt.isLoading || swapRcpt.isLoading
  const retention = quote?.instantExit ? Number(BigInt(quote.instantExit)) / Number(BigInt(quote.amountIn)) : null

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="label">Order</span>
        <span className="pill pill-pen">Real · you sign</span>
      </div>

      {wrongChain && (
        <button className="btn btn-ghost mb-4 w-full" onClick={() => switchChain({ chainId: 4663 })}>
          Switch wallet to Robinhood Chain
        </button>
      )}
      {stock && (
        <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Tokenized stock: the issuer restricts transfers by jurisdiction and eligibility inside the token contract. The quote is exact, but
          the swap reverts for wallets the issuer hasn&rsquo;t cleared.
        </p>
      )}

      <div className="seg mb-4 w-full" role="tablist">
        {(['buy', 'sell'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)} className="flex-1" style={side === s ? { color: s === 'buy' ? 'var(--up)' : 'var(--down)' } : undefined}>
            {s === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      {side === 'buy' ? (
        <div>
          <label className="label mb-1.5 block" htmlFor="real-eth">
            Spend · wallet {ethBal.data ? formatEth(ethBal.data.value, 4) : '…'} ETH
          </label>
          <div className="relative">
            <input id="real-eth" type="text" inputMode="decimal" value={ethIn} onChange={(e) => setEthIn(e.target.value)} className="field num pr-14" />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-muted">ETH</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {['0.01', '0.05', '0.1', '0.5'].map((p) => (
              <button key={p} onClick={() => setEthIn(p)} className={`chip h-8 px-3 ${ethIn === p ? 'chip-active' : ''}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <label className="label mb-1.5 block" htmlFor="real-pct">
            Sell {sellPct}% of {formatQty(held, baseDecimals)} {baseSymbol}
          </label>
          <input id="real-pct" type="range" min={1} max={100} value={sellPct} onChange={(e) => setSellPct(Number(e.target.value))} className="w-full accent-[var(--down)]" />
          <div className="mt-1 flex gap-1.5">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} onClick={() => setSellPct(p)} className={`chip h-8 px-3 ${sellPct === p ? 'chip-active' : ''}`}>
                {p}%
              </button>
            ))}
          </div>
          {held === 0n && <p className="mt-2 text-[13px] text-down">This wallet holds no {baseSymbol}.</p>}
        </div>
      )}

      <div className="mt-5 space-y-2 border-t border-line pt-4 text-[13.5px]">
        {quote ? (
          <>
            {quote.route && <Row label={quote.route.twoLeg ? 'Route · 2 legs' : 'Route'} value={quote.route.label} valueClass="text-pen" mono={false} />}
            <Row label="Spot" value={`${formatPrice(quote.spotPrice)} ETH`} />
            <Row label="Your fill" value={`${formatPrice(quote.execPrice)} ETH`} />
            <Row label="Price impact" value={formatBps(quote.priceImpactBps)} valueClass={quote.priceImpactBps > 300 ? 'text-down font-semibold' : quote.priceImpactBps > 75 ? 'text-warn' : ''} />
            <Row label="LP fee" value={formatBps(quote.feeBps)} />
            <Row label="You receive" value={side === 'buy' ? `${formatQty(BigInt(quote.amountOut), baseDecimals)} ${baseSymbol}` : `${formatEth(BigInt(quote.amountOut))} ETH`} strong />
            <Row label="Minimum · 1% slippage" value={side === 'buy' ? `${formatQty(minOutFrom(BigInt(quote.amountOut), SLIPPAGE_BPS), baseDecimals)} ${baseSymbol}` : `${formatEth(minOutFrom(BigInt(quote.amountOut), SLIPPAGE_BPS))} ETH`} valueClass="text-muted" />
            {side === 'buy' && quote.instantExit && retention !== null && (
              <Row label="Sold right back" value={`${formatEth(BigInt(quote.instantExit))} ETH · ${(retention * 100).toFixed(1)}%`} valueClass={retention < 0.9 ? 'text-down' : 'text-muted'} />
            )}
            {quote.route && !quote.route.executable && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">This route mixes v3 and v4 legs — no single transaction can sign it. Try a different size.</p>
            )}
            {quote.route?.hooked && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">Hook pool: this fill comes from the on-chain quoter, and the hook can still refuse the real swap. Your wallet will show a failed simulation if so.</p>
            )}
            {(quote.fillRatio < 1 || quote.exhaustedWindow) && (
              <p className="rounded-lg bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">The pool can&rsquo;t absorb this size — only {(quote.fillRatio * 100).toFixed(1)}% fills.</p>
            )}
          </>
        ) : (
          <p className="text-faint">Enter a size to see the exact fill.</p>
        )}
        {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
        {swap.data && (
          <p className="rounded-lg bg-up-soft px-3 py-2 text-[13px] text-up">
            {swapRcpt.isSuccess ? 'Mined ✓' : 'Submitted…'}{' '}
            <a className="underline" href={`${EXPLORER_URL}/tx/${swap.data}`} target="_blank" rel="noreferrer">
              view transaction
            </a>
          </p>
        )}
      </div>

      {needsApproval ? (
        <button onClick={onApprove} disabled={busy || wrongChain || amount <= 0n} className="btn btn-pen mt-5 w-full">
          {busy
            ? 'Approving…'
            : approvalStep === 'permit2-router'
              ? `Allow the router to spend ${baseSymbol} · Permit2, 30 days`
              : approvalStep === 'permit2-erc20'
                ? `Approve ${baseSymbol} for Permit2 · step 1 of 2`
                : `Approve ${baseSymbol} for the router`}
        </button>
      ) : (
        <button onClick={onSwap} disabled={busy || wrongChain || !quote || blocked || amount <= 0n} className={`btn mt-5 w-full ${side === 'buy' ? 'btn-primary' : 'btn-danger'}`}>
          {busy ? 'Confirm in wallet…' : side === 'buy' ? `Buy ${baseSymbol}` : `Sell ${baseSymbol}`}
        </button>
      )}
      <p className="mt-2 text-center text-[12px] text-faint">
        Signed by your wallet through Uniswap&rsquo;s {router === 'v4' ? 'Universal Router (v4)' : 'SwapRouter02 (v3)'} · we never hold funds.
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
