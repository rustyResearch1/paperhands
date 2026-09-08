'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { EXPLORER_URL, UNISWAP, erc20Abi, erc20WriteAbi } from '@paperhands/chain'
import { maxUint256, type Address } from 'viem'
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { formatEth, formatQty } from '@/lib/format'
import { buildMint } from '@/lib/lpexecute'

interface Plan {
  token0: string
  token1: string
  fee: number
  tickLower: number
  tickUpper: number
  currentTick: number
  amount0: string
  amount1: string
  wethIs: 0 | 1 | null
  baseIsToken0: boolean
}

interface Props {
  pool: string
  baseAddress: string
  baseSymbol: string
  baseDecimals: number
  rangePct: number
  eth: string
}

/** "Open this position for real": exact amounts, approval, one signed mint. */
export default function RealLpMint({ pool, baseAddress, baseSymbol, baseDecimals, rangePct, eth }: Props) {
  const { address, isConnected } = useAccount()
  const qc = useQueryClient()
  const [stage, setStage] = useState<'idle' | 'approving' | 'minting'>('idle')
  const [error, setError] = useState<string | null>(null)

  const plan = useQuery({
    queryKey: ['mintplan', pool, rangePct, eth],
    queryFn: async () => (await fetch(`/api/lp/plan?pool=${pool}&range=${rangePct}&eth=${eth}`)).json() as Promise<{ plan?: Plan; error?: string }>,
    enabled: Boolean(address) && Number(eth) > 0,
    staleTime: 15_000,
  })
  const p = plan.data?.plan
  const baseAmount = p ? BigInt(p.baseIsToken0 ? p.amount0 : p.amount1) : 0n
  const wethAmount = p ? BigInt(p.wethIs === 0 ? p.amount0 : p.wethIs === 1 ? p.amount1 : '0') : 0n

  const ethBal = useBalance({ address, query: { enabled: Boolean(address) } })
  const tokenBal = useReadContract({ address: baseAddress as Address, abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined, query: { enabled: Boolean(address) } })
  const allowance = useReadContract({ address: baseAddress as Address, abi: erc20WriteAbi, functionName: 'allowance', args: address ? [address, UNISWAP.positionManager] : undefined, query: { enabled: Boolean(address) } })

  const approve = useWriteContract()
  const mint = useWriteContract()
  const approveRcpt = useWaitForTransactionReceipt({ hash: approve.data })
  const mintRcpt = useWaitForTransactionReceipt({ hash: mint.data })
  useEffect(() => {
    if (approveRcpt.isSuccess) {
      setStage('idle')
      allowance.refetch()
    }
  }, [approveRcpt.isSuccess, allowance])
  useEffect(() => {
    if (mintRcpt.isSuccess) {
      setStage('idle')
      qc.invalidateQueries({ queryKey: ['lp', address] })
    }
  }, [mintRcpt.isSuccess, address, qc])

  if (!isConnected || !address) return null
  const held = (tokenBal.data as bigint | undefined) ?? 0n
  const haveEth = ethBal.data?.value ?? 0n
  const needsApproval = baseAmount > 0n && ((allowance.data as bigint | undefined) ?? 0n) < baseAmount
  const shortToken = baseAmount > held
  const shortEth = wethAmount > haveEth
  const busy = stage !== 'idle' || approve.isPending || mint.isPending || approveRcpt.isLoading || mintRcpt.isLoading

  async function onApprove() {
    setStage('approving')
    setError(null)
    try {
      await approve.writeContractAsync({ address: baseAddress as Address, abi: erc20WriteAbi, functionName: 'approve', args: [UNISWAP.positionManager, maxUint256] })
    } catch (e) {
      setStage('idle')
      setError((e as Error).message.split('\n')[0] ?? 'Approval rejected')
    }
  }
  async function onMint() {
    if (!p) return
    setStage('minting')
    setError(null)
    try {
      const tx = buildMint(p, address!)
      await mint.writeContractAsync({ address: tx.address, abi: tx.abi, functionName: tx.functionName, args: tx.args as never, value: tx.value })
    } catch (e) {
      setStage('idle')
      setError((e as Error).message.split('\n')[0] ?? 'Transaction rejected')
    }
  }

  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4 text-[13.5px]">
      <div className="flex items-center justify-between">
        <span className="label">Open for real</span>
        <span className="pill pill-pen">you sign</span>
      </div>
      {plan.data?.error && <p className="rounded-lg bg-down-soft px-3 py-2 text-[13px] text-down">{plan.data.error}</p>}
      {p && (
        <>
          <Row label="Range (ticks)" value={`${p.tickLower} → ${p.tickUpper} · now ${p.currentTick}`} />
          <Row label="Needs" value={`${formatEth(wethAmount, 4)} ETH + ${formatQty(baseAmount, baseDecimals)} ${baseSymbol}`} strong />
          <Row label="Wallet has" value={`${formatEth(haveEth, 4)} ETH · ${formatQty(held, baseDecimals)} ${baseSymbol}`} valueClass={shortToken || shortEth ? 'text-down' : 'text-muted'} />
          {shortToken && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
              Not enough {baseSymbol} — buy {formatQty(baseAmount - held, baseDecimals)} more in the order sheet first, then mint.
            </p>
          )}
          {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
          {mint.data && (
            <p className="rounded-lg bg-up-soft px-3 py-2 text-[13px] text-up">
              {mintRcpt.isSuccess ? 'Position minted ✓' : 'Submitted…'}{' '}
              <a className="underline" href={`${EXPLORER_URL}/tx/${mint.data}`} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </p>
          )}
          {needsApproval ? (
            <button onClick={onApprove} disabled={busy || shortToken} className="btn btn-pen w-full">
              {busy ? 'Approving…' : `Approve ${baseSymbol} for the position manager`}
            </button>
          ) : (
            <button onClick={onMint} disabled={busy || shortToken || shortEth} className="btn btn-primary w-full">
              {busy ? 'Confirm in wallet…' : 'Mint this position'}
            </button>
          )}
          <p className="text-[12px] text-faint">Mints through Uniswap&rsquo;s NonfungiblePositionManager with 1% amount slippage and a 10-minute deadline. ETH is wrapped by the manager; leftovers refund.</p>
        </>
      )}
    </div>
  )
}

function Row({ label, value, strong, valueClass }: { label: string; value: string; strong?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={`num text-right ${strong ? 'font-semibold' : ''} ${valueClass ?? ''}`}>{value}</span>
    </div>
  )
}
