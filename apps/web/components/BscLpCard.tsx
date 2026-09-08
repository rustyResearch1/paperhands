'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { erc20Abi, erc20WriteAbi } from '@paperhands/chain'
import { maxUint256, type Address } from 'viem'
import { useAccount, useBalance, useConnect, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { formatQty } from '@/lib/format'
import { buildClose, buildCollect, buildMint, type LpVenue } from '@/lib/lpexecute'
import { useMode } from '@/lib/mode'
import { BSC_SPENDER, EXPLORER } from '@/lib/x/types'

const BSC_ID = 56 as const
const VENUE: LpVenue = { positionManager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364', wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEbF2De08d9173bc095c' }
void BSC_SPENDER

interface PoolChoice {
  pool: string
  fee: number
  tickSpacing: number
  tick: number
  depthBnb: number
  wbnbIsToken0: boolean
}
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
interface Position {
  tokenId: string
  pool: string | null
  token0: string
  token1: string
  symbol0: string
  symbol1: string
  decimals0: number
  decimals1: number
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
  valueBnb: number | null
}

function shortError(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? 'failed'
  return m.split('\n')[0]!.slice(0, 140)
}

/**
 * LP on PancakeSwap v3 from a token page: pick a fee tier, a σ-based range and
 * a BNB deposit; approve the token once; mint through Pancake's position
 * manager — the same builders as Robinhood Chain, different addresses.
 */
export default function BscLpCard({ token, symbol, decimals }: { token: string; symbol: string; decimals: number }) {
  const { mode } = useMode()
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const qc = useQueryClient()
  const [poolAddr, setPoolAddr] = useState<string | null>(null)
  const [rangePct, setRangePct] = useState<number | null>(null)
  const [bnb, setBnb] = useState('0.1')
  const [stage, setStage] = useState<'idle' | 'approving' | 'minting' | 'lp'>('idle')
  const [error, setError] = useState<string | null>(null)

  const pools = useQuery({ queryKey: ['bsclp', 'pools', token], queryFn: async () => (await fetch(`/api/lp/bsc?token=${token}`)).json() as Promise<{ pools: PoolChoice[]; error?: string }> })
  const chosen = pools.data?.pools.find((p) => p.pool === poolAddr) ?? pools.data?.pools[0]
  const strategy = useQuery({
    queryKey: ['bsclp', 'ranges', chosen?.pool],
    queryFn: async () => (await fetch(`/api/lp/bsc?pool=${chosen!.pool}`)).json() as Promise<{ strategy: { sigma24Pct: number | null; ranges: { label: string; pct: number; note: string }[] } }>,
    enabled: Boolean(chosen),
    staleTime: 5 * 60_000,
  })
  const effRange = rangePct ?? strategy.data?.strategy.ranges[1]?.pct ?? null
  const plan = useQuery({
    queryKey: ['bsclp', 'plan', chosen?.pool, effRange, bnb],
    queryFn: async () => (await fetch(`/api/lp/bsc?pool=${chosen!.pool}&range=${effRange}&bnb=${bnb}`)).json() as Promise<{ plan?: Plan; error?: string }>,
    enabled: Boolean(chosen) && effRange !== null && Number(bnb) > 0,
    staleTime: 15_000,
  })
  const positions = useQuery({
    queryKey: ['bsclp', 'positions', address],
    queryFn: async () => (await fetch(`/api/lp/bsc?owner=${address}`)).json() as Promise<{ positions: Position[]; error?: string }>,
    enabled: Boolean(address) && mode === 'real',
    refetchInterval: 60_000,
  })

  const p = plan.data?.plan
  const baseAmount = p ? BigInt(p.baseIsToken0 ? p.amount0 : p.amount1) : 0n
  const bnbAmount = p ? BigInt(p.wethIs === 0 ? p.amount0 : p.wethIs === 1 ? p.amount1 : '0') : 0n
  const bnbBal = useBalance({ address, chainId: BSC_ID, query: { enabled: Boolean(address) } })
  const tokenBal = useReadContract({ address: token as Address, abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined, chainId: BSC_ID, query: { enabled: Boolean(address) } })
  const allowance = useReadContract({ address: token as Address, abi: erc20WriteAbi, functionName: 'allowance', args: address ? [address, VENUE.positionManager] : undefined, chainId: BSC_ID, query: { enabled: Boolean(address) } })

  const approve = useWriteContract()
  const mint = useWriteContract()
  const lpTx = useWriteContract()
  const approveRcpt = useWaitForTransactionReceipt({ hash: approve.data, chainId: BSC_ID })
  const mintRcpt = useWaitForTransactionReceipt({ hash: mint.data, chainId: BSC_ID })
  const lpRcpt = useWaitForTransactionReceipt({ hash: lpTx.data, chainId: BSC_ID })
  useEffect(() => {
    if (approveRcpt.isSuccess) {
      setStage('idle')
      allowance.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveRcpt.isSuccess])
  useEffect(() => {
    if (mintRcpt.isSuccess || lpRcpt.isSuccess) {
      setStage('idle')
      qc.invalidateQueries({ queryKey: ['bsclp', 'positions'] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintRcpt.isSuccess, lpRcpt.isSuccess])

  const held = (tokenBal.data as bigint | undefined) ?? 0n
  const haveBnb = bnbBal.data?.value ?? 0n
  const needsApproval = baseAmount > 0n && ((allowance.data as bigint | undefined) ?? 0n) < baseAmount
  const shortToken = baseAmount > held
  const shortBnb = bnbAmount > haveBnb
  const wrongChain = isConnected && chainId !== BSC_ID
  const busy = stage !== 'idle'

  async function ensureChain() {
    if (wrongChain) await switchChainAsync({ chainId: BSC_ID })
  }
  async function onApprove() {
    setStage('approving')
    setError(null)
    try {
      await ensureChain()
      await approve.writeContractAsync({ address: token as Address, abi: erc20WriteAbi, functionName: 'approve', args: [VENUE.positionManager, maxUint256], chainId: BSC_ID })
    } catch (e) {
      setStage('idle')
      setError(shortError(e))
    }
  }
  async function onMint() {
    if (!p || !address) return
    setStage('minting')
    setError(null)
    try {
      await ensureChain()
      const tx = buildMint(p, address, 100, VENUE)
      await mint.writeContractAsync({ address: tx.address, abi: tx.abi, functionName: tx.functionName, args: tx.args as never, value: tx.value, chainId: BSC_ID })
    } catch (e) {
      setStage('idle')
      setError(shortError(e))
    }
  }
  async function onPosition(pos: Position, what: 'collect' | 'close') {
    if (!address) return
    setStage('lp')
    setError(null)
    try {
      await ensureChain()
      const tx = what === 'collect' ? buildCollect(pos, address, VENUE) : buildClose(pos, address, 100, VENUE)
      await lpTx.writeContractAsync({ address: tx.address, abi: tx.abi, functionName: tx.functionName, args: tx.args as never, value: tx.value, chainId: BSC_ID })
    } catch (e) {
      setStage('idle')
      setError(shortError(e))
    }
  }

  const myPositions = (positions.data?.positions ?? []).filter((x) => x.token0 === token.toLowerCase() || x.token1 === token.toLowerCase())

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">LP · PancakeSwap v3</span>
        <span className="pill">BNB deposit</span>
      </div>
      {pools.data?.pools.length === 0 && <p className="text-[13.5px] text-muted">No WBNB pool for {symbol} on PancakeSwap v3 yet.</p>}
      {pools.data?.error && <p className="text-[13px] text-down">{pools.data.error}</p>}
      {pools.data && pools.data.pools.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {pools.data.pools.map((pl) => (
              <button key={pl.pool} onClick={() => setPoolAddr(pl.pool)} className={`chip ${chosen?.pool === pl.pool ? 'chip-active' : ''}`} title={`${pl.depthBnb.toFixed(2)} BNB active depth`}>
                {(pl.fee / 10_000).toFixed(2)}% · {pl.depthBnb.toFixed(1)} BNB deep
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted">
              {strategy.data?.strategy.sigma24Pct !== null && strategy.data?.strategy.sigma24Pct !== undefined ? `24h realized vol ±${strategy.data.strategy.sigma24Pct.toFixed(0)}%` : 'range'}
            </span>
            {strategy.data?.strategy.ranges.map((r) => (
              <button key={r.label} onClick={() => setRangePct(r.pct)} className={`chip ${effRange === r.pct ? 'chip-active' : ''}`} title={r.note}>
                {r.label} ±{r.pct}%
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-[12px] text-muted">
              Range ±%
              <input className="field field-sm num mt-1" type="text" inputMode="decimal" value={effRange ?? ''} onChange={(e) => setRangePct(Number(e.target.value) || null)} />
            </label>
            <label className="text-[12px] text-muted">
              Deposit BNB
              <input className="field field-sm num mt-1" type="text" inputMode="decimal" value={bnb} onChange={(e) => setBnb(e.target.value)} />
            </label>
          </div>
          {p && (
            <div className="mt-3 space-y-1.5 text-[13.5px]">
              <Row label="Ticks" value={`${p.tickLower} → ${p.tickUpper} · now ${p.currentTick}`} />
              <Row label="Needs" value={`${formatQty(bnbAmount, 18)} BNB + ${formatQty(baseAmount, decimals)} ${symbol}`} strong />
              {isConnected && <Row label="Wallet has" value={`${formatQty(haveBnb, 18)} BNB · ${formatQty(held, decimals)} ${symbol}`} valueClass={shortToken || shortBnb ? 'text-down' : 'text-muted'} />}
            </div>
          )}
          {plan.data?.error && <p className="mt-2 text-[13px] text-down">{plan.data.error}</p>}
          {mode !== 'real' ? (
            <p className="mt-3 rounded-xl bg-bg-2 px-3 py-2 text-[13px] text-muted">
              Switch to <span className="font-semibold text-ink">Real</span> to open this position from your wallet.
            </p>
          ) : !isConnected ? (
            <button
              className="btn btn-primary mt-3 w-full"
              onClick={() => {
                const c = connectors.find((x) => x.id === 'injected') ?? connectors[0]
                if (c) connect({ connector: c })
              }}
            >
              Connect wallet
            </button>
          ) : (
            <>
              {shortToken && p && <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">Not enough {symbol} — buy {formatQty(baseAmount - held, decimals)} more in the order sheet first.</p>}
              {needsApproval ? (
                <button onClick={onApprove} disabled={busy || shortToken || !p} className="btn btn-pen mt-3 w-full">
                  {stage === 'approving' ? 'Approving…' : `Approve ${symbol} for the position manager`}
                </button>
              ) : (
                <button onClick={onMint} disabled={busy || shortToken || shortBnb || !p} className="btn btn-primary mt-3 w-full">
                  {stage === 'minting' ? 'Confirm in wallet…' : 'Mint this position'}
                </button>
              )}
            </>
          )}
          {error && <p className="mt-2 rounded-xl bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
          {mint.data && (
            <p className="mt-2 rounded-xl bg-up-soft px-3 py-2 text-[13px] text-up">
              {mintRcpt.isSuccess ? 'Position minted ✓' : 'Submitted…'}{' '}
              <a className="underline" href={EXPLORER.bsc.tx(mint.data)} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </p>
          )}
        </>
      )}

      {mode === 'real' && isConnected && myPositions.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <span className="label">Your positions here</span>
          <ul className="mt-2 space-y-2 text-[13px]">
            {myPositions.map((pos) => (
              <li key={pos.tokenId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className={`pill ${pos.inRange ? 'pill-up' : 'pill-warn'}`}>{pos.currentTick === null ? 'unknown' : pos.inRange ? 'in range' : 'out of range'}</span>{' '}
                  <span className="num text-muted">
                    {pos.tickLower}→{pos.tickUpper} · {(pos.fee / 10_000).toFixed(2)}%
                  </span>{' '}
                  <span className="num">{pos.valueBnb !== null ? `${pos.valueBnb.toFixed(4)} BNB` : ''}</span>
                </span>
                <span className="flex gap-1">
                  <button className="btn btn-ghost btn-sm" disabled={busy || (BigInt(pos.owed0) === 0n && BigInt(pos.owed1) === 0n)} onClick={() => onPosition(pos, 'collect')}>
                    Collect
                  </button>
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => onPosition(pos, 'close')}>
                    Close
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {lpTx.data && (
            <p className="mt-2 text-[12px] text-up">
              {lpRcpt.isSuccess ? 'Done ✓' : 'Submitted…'}{' '}
              <a className="underline" href={EXPLORER.bsc.tx(lpTx.data)} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </p>
          )}
        </div>
      )}
      <p className="mt-3 text-[12px] text-faint">
        Ranges from realized volatility (1σ / 2σ / 4σ). Mints through PancakeSwap&rsquo;s NonfungiblePositionManager with 1% amount slippage; BNB is wrapped by the manager, leftovers refund. Collect unwraps to BNB; Close pulls liquidity, collects and burns.
      </p>
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
