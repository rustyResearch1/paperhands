'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatQty, formatUsd } from '@/lib/format'
import { useMode } from '@/lib/mode'
import { useSolana, waitForSignature } from '@/lib/solana'
import { EXPLORER } from '@/lib/x/types'

interface PoolChoice {
  address: string
  name: string
  tickSpacing: number
  feeRate: number
  tvlUsd: number
  volume24Usd: number
  fees24Usd: number
  solIsA: boolean
  tokenA: { mint: string; symbol: string; decimals: number }
  tokenB: { mint: string; symbol: string; decimals: number }
}
interface Plan {
  positionMint: string
  tickLower: number
  tickUpper: number
  currentTick: number
  solIsA: boolean
  estA: string
  estB: string
  transaction: string
}
interface Position {
  address: string
  pool: string
  name: string
  tokenA: { mint: string; symbol: string; decimals: number }
  tokenB: { mint: string; symbol: string; decimals: number }
  tickLower: number
  tickUpper: number
  currentTick: number
  inRange: boolean
  amountA: string
  amountB: string
  feeOwedA: string
  feeOwedB: string
  valueSol: number | null
  feeRate: number
}

function shortError(e: unknown): string {
  return ((e as Error)?.message ?? 'failed').split('\n')[0]!.slice(0, 160)
}

/**
 * LP on Orca Whirlpools from a Solana token page: pick a pool, a σ-based
 * range and a SOL deposit; the position transaction is built for your pubkey
 * and signed in your wallet. Close removes liquidity, collects and burns.
 */
export default function SolLpCard({ token, symbol, decimals }: { token: string; symbol: string; decimals: number }) {
  const { mode } = useMode()
  const sol = useSolana()
  const qc = useQueryClient()
  const [poolAddr, setPoolAddr] = useState<string | null>(null)
  const [rangePct, setRangePct] = useState<number | null>(null)
  const [deposit, setDeposit] = useState('0.5')
  const [stage, setStage] = useState<'idle' | 'building' | 'signing' | 'confirming'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastPlan, setLastPlan] = useState<Plan | null>(null)
  const [sig, setSig] = useState<{ sig: string; state: 'pending' | 'confirmed' | 'failed' } | null>(null)

  const pools = useQuery({ queryKey: ['sollp', 'pools', token], queryFn: async () => (await fetch(`/api/lp/sol?token=${token}`)).json() as Promise<{ pools: PoolChoice[]; error?: string }> })
  const chosen = pools.data?.pools.find((p) => p.address === poolAddr) ?? pools.data?.pools[0]
  const strategy = useQuery({
    queryKey: ['sollp', 'ranges', chosen?.address],
    queryFn: async () => (await fetch(`/api/lp/sol?pool=${chosen!.address}`)).json() as Promise<{ strategy: { sigma24Pct: number | null; ranges: { label: string; pct: number; note: string }[] } }>,
    enabled: Boolean(chosen),
    staleTime: 5 * 60_000,
  })
  const effRange = rangePct ?? strategy.data?.strategy.ranges[1]?.pct ?? null
  const positions = useQuery({
    queryKey: ['sollp', 'positions', sol.publicKey],
    queryFn: async () => (await fetch(`/api/lp/sol?owner=${sol.publicKey}`)).json() as Promise<{ positions: Position[]; error?: string }>,
    enabled: Boolean(sol.publicKey) && mode === 'real',
    refetchInterval: 60_000,
  })
  const mine = (positions.data?.positions ?? []).filter((p) => p.tokenA.mint === token || p.tokenB.mint === token)
  const busy = stage !== 'idle'

  async function run(build: () => Promise<string[]>, label: string) {
    setError(null)
    setSig(null)
    try {
      setStage('building')
      const txs = await build()
      for (const tx of txs) {
        setStage('signing')
        const s = await sol.signAndSend(tx)
        setSig({ sig: s, state: 'pending' })
        setStage('confirming')
        const st = await waitForSignature(s)
        setSig({ sig: s, state: st === 'confirmed' ? 'confirmed' : st === 'failed' ? 'failed' : 'pending' })
        if (st === 'failed') throw new Error(`${label} failed on-chain`)
      }
      qc.invalidateQueries({ queryKey: ['sollp', 'positions'] })
      qc.invalidateQueries({ queryKey: ['solbal'] })
    } catch (e) {
      setError(shortError(e))
    } finally {
      setStage('idle')
    }
  }

  async function onOpen() {
    if (!chosen || !sol.publicKey || effRange === null) return
    await run(async () => {
      const r = (await (
        await fetch('/api/lp/sol', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'open', pool: chosen.address, range: effRange, sol: Number(deposit), owner: sol.publicKey }) })
      ).json()) as { plan?: Plan; error?: string }
      if (r.error || !r.plan) throw new Error(r.error ?? 'no plan')
      setLastPlan(r.plan)
      return [r.plan.transaction]
    }, 'open')
  }
  async function onClose(p: Position) {
    if (!sol.publicKey) return
    await run(async () => {
      const r = (await (await fetch('/api/lp/sol', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'close', position: p.address, owner: sol.publicKey }) })).json()) as { transactions?: string[]; error?: string }
      if (r.error || !r.transactions) throw new Error(r.error ?? 'no transaction')
      return r.transactions
    }, 'close')
  }

  const otherSym = (p: PoolChoice) => (p.solIsA ? p.tokenB.symbol : p.tokenA.symbol)

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">LP · Orca Whirlpools</span>
        <span className="pill">SOL deposit</span>
      </div>
      {pools.data?.pools.length === 0 && <p className="text-[13.5px] text-muted">No SOL pool for {symbol} on Orca yet.</p>}
      {pools.data?.error && <p className="text-[13px] text-down">{pools.data.error}</p>}
      {pools.data && pools.data.pools.length > 0 && chosen && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {pools.data.pools.slice(0, 5).map((pl) => (
              <button key={pl.address} onClick={() => setPoolAddr(pl.address)} className={`chip ${chosen.address === pl.address ? 'chip-active' : ''}`} title={`${pl.name} · spacing ${pl.tickSpacing} · ${formatUsd(pl.volume24Usd)} vol 24h`}>
                {(pl.feeRate / 10_000).toFixed(2)}% · {formatUsd(pl.tvlUsd)} TVL
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {chosen.name} · fees 24h {formatUsd(chosen.fees24Usd)} on {formatUsd(chosen.tvlUsd)} TVL ({chosen.tvlUsd > 0 ? `${((chosen.fees24Usd / chosen.tvlUsd) * 100).toFixed(2)}%/day` : '—'})
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted">{strategy.data?.strategy.sigma24Pct != null ? `24h realized vol ±${strategy.data.strategy.sigma24Pct.toFixed(0)}%` : 'range'}</span>
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
              Deposit SOL · total value
              <input className="field field-sm num mt-1" type="text" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </label>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            About half in SOL and half in {otherSym(chosen)} at the current price; both must be in your wallet. Buy {otherSym(chosen)} in the order sheet first if needed.
          </p>
          {mode !== 'real' ? (
            <p className="mt-3 rounded-xl bg-bg-2 px-3 py-2 text-[13px] text-muted">
              Switch to <span className="font-semibold text-ink">Real</span> to open this position from your wallet.
            </p>
          ) : !sol.publicKey ? (
            <button className="btn btn-primary mt-3 w-full" onClick={() => sol.connect().catch((e) => setError(shortError(e)))} disabled={sol.connecting}>
              {sol.available ? `Connect ${sol.walletName}` : 'Install Phantom'}
            </button>
          ) : (
            <button onClick={onOpen} disabled={busy || effRange === null || !(Number(deposit) > 0)} className="btn btn-primary mt-3 w-full">
              {stage === 'building' ? 'Building…' : stage === 'signing' ? 'Confirm in wallet…' : stage === 'confirming' ? 'Confirming…' : 'Open this position'}
            </button>
          )}
          {lastPlan && !error && (
            <p className="mt-2 text-[12px] text-muted">
              Ticks {lastPlan.tickLower} → {lastPlan.tickUpper} (now {lastPlan.currentTick}) · {formatQty(BigInt(lastPlan.estA), chosen.tokenA.decimals)} {chosen.tokenA.symbol} + {formatQty(BigInt(lastPlan.estB), chosen.tokenB.decimals)} {chosen.tokenB.symbol}
            </p>
          )}
          {error && <p className="mt-2 rounded-xl bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
          {sig && (
            <p className={`mt-2 rounded-xl px-3 py-2 text-[13px] ${sig.state === 'failed' ? 'bg-down-soft text-down' : 'bg-up-soft text-up'}`}>
              {sig.state === 'confirmed' ? 'Confirmed ✓' : sig.state === 'failed' ? 'Failed on-chain' : 'Submitted…'}{' '}
              <a className="underline" href={EXPLORER.sol.tx(sig.sig)} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </p>
          )}
        </>
      )}

      {mode === 'real' && sol.publicKey && mine.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <span className="label">Your positions here</span>
          <ul className="mt-2 space-y-2 text-[13px]">
            {mine.map((p) => (
              <li key={p.address} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className={`pill ${p.inRange ? 'pill-up' : 'pill-warn'}`}>{p.inRange ? 'in range' : 'out of range'}</span>{' '}
                  <span className="num text-muted">
                    {p.tickLower}→{p.tickUpper} · {(p.feeRate / 10_000).toFixed(2)}%
                  </span>{' '}
                  <span className="num">{p.valueSol !== null ? `${p.valueSol.toFixed(4)} SOL` : ''}</span>
                  {(BigInt(p.feeOwedA) > 0n || BigInt(p.feeOwedB) > 0n) && <span className="ml-1 text-[12px] text-up">fees owed</span>}
                </span>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => onClose(p)}>
                  Close
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[12px] text-faint">
        Ranges from realized volatility (1σ / 2σ / 4σ). The transaction is built for your pubkey and signed in your wallet with 1% slippage; the only server signature is the position mint. Close removes liquidity, collects fees and burns the position.
      </p>
    </div>
  )
}
