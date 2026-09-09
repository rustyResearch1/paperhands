'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useAccount, useConnect } from 'wagmi'
import LpActions from '@/components/LpActions'
import { formatEth, formatQty, formatUsd } from '@/lib/format'
import Kpi from '@/components/Kpi'

interface Holding {
  token: string
  symbol: string
  decimals: number
  balance: string
  realizableWei: string | null
  markEth: number | null
}
interface Holdings {
  ethWei: string
  holdings: Holding[]
  totalRealizableWei: string
}
interface Lp {
  tokenId: string
  pool: string | null
  token0: string
  token1: string
  symbol0: string
  symbol1: string
  decimals0: number
  decimals1: number
  liquidity: string
  fee: number
  tickLower: number
  tickUpper: number
  currentTick: number | null
  inRange: boolean
  amount0: string
  amount1: string
  owed0: string
  owed1: string
  valueQuote: number | null
  quoteSymbol: string | null
}

export default function RealPortfolio({ usdRate }: { usdRate: number | null }) {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()

  const holdings = useQuery({
    queryKey: ['holdings', address],
    queryFn: async () => (await fetch(`/api/wallet?address=${address}`)).json() as Promise<Holdings & { error?: string }>,
    enabled: Boolean(address),
    refetchInterval: 30_000,
  })
  const lp = useQuery({
    queryKey: ['lp', address],
    queryFn: async () => (await fetch(`/api/wallet?address=${address}&what=lp`)).json() as Promise<{ positions: Lp[]; error?: string }>,
    enabled: Boolean(address),
    refetchInterval: 60_000,
  })

  if (!isConnected || !address) {
    const c = connectors.find((x) => x.id === 'injected') ?? connectors[0]
    return (
      <div className="card mx-auto my-8 max-w-md p-8 text-center">
        <div className="pill pill-pen mb-3">real mode</div>
        <h2 className="text-[20px] font-semibold">Connect your wallet</h2>
        <p className="mb-4 mt-1 text-muted">Read-only first: your holdings and LP positions, valued at what the pool would actually pay. We never hold keys.</p>
        <button className="btn btn-primary" disabled={!c || isPending} onClick={() => c && connect({ connector: c })}>
          {isPending ? 'Connecting…' : 'Connect wallet'}
        </button>
      </div>
    )
  }

  const h = holdings.data
  const eth = h ? BigInt(h.ethWei) : 0n
  const total = h ? eth + BigInt(h.totalRealizableWei) : 0n

  return (
    <div className="space-y-5">
      <div className="rise">
        <div className="label">Real portfolio · {address.slice(0, 6)}…{address.slice(-4)}</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="num text-[40px] font-semibold leading-none tracking-tight">
            {h ? (usdRate ? formatUsd((Number(total) / 1e18) * usdRate) : `${formatEth(total)} ETH`) : '…'}
          </span>
          {h && <span className="num text-[15px] text-muted">{formatEth(total)} ETH · pool-would-pay basis</span>}
        </div>
        {h?.error && <p className="mt-2 text-[13px] text-down">{h.error}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="ETH" value={h ? `${formatEth(eth, 4)} ETH` : '…'} />
        <Kpi label="Tokens · pool would pay" value={h ? `${formatEth(BigInt(h.totalRealizableWei), 4)} ETH` : '…'} hero />
        <Kpi label="LP positions" value={lp.data ? String(lp.data.positions.length) : '…'} />
      </div>

      <div className="card rise rise-2 overflow-hidden">
        <div className="px-5 pt-4">
          <span className="label">Holdings</span>
        </div>
        <div className="overflow-x-auto px-2 pb-2 pt-2">
          <table className="tbl">
            <thead>
              <tr>
                <th>Token</th>
                <th>Balance</th>
                <th>Marked</th>
                <th>Pool would pay</th>
              </tr>
            </thead>
            <tbody>
              {h?.holdings.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted">
                    No tracked tokens in this wallet yet.
                  </td>
                </tr>
              )}
              {h?.holdings.map((x) => (
                <tr key={x.token}>
                  <td className="font-semibold">{x.symbol}</td>
                  <td>{formatQty(BigInt(x.balance), x.decimals)}</td>
                  <td className="text-muted line-through decoration-down/60">{x.markEth !== null ? x.markEth.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}</td>
                  <td className="font-semibold">
                    <span className="hilite">{x.realizableWei ? `${formatEth(BigInt(x.realizableWei))} ETH` : 'unroutable'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card rise rise-3 overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="label">Liquidity positions · Uniswap v3</span>
          <span className="text-[12px] text-faint">live amounts at the current price</span>
        </div>
        {(() => {
          const out = lp.data?.positions.filter((p) => p.currentTick !== null && !p.inRange && BigInt(p.liquidity) > 0n) ?? []
          if (out.length === 0) return null
          return (
            <div className="mx-5 mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px]">
              <span className="pill pill-warn">out of range</span>
              <span>
                {out.length === 1 ? '1 position is' : `${out.length} positions are`} earning nothing right now — close or re-range{' '}
                {out.map((p) => p.symbol0 + '/' + p.symbol1).join(', ')}.
              </span>
            </div>
          )
        })()}
        <div className="overflow-x-auto px-2 pb-2 pt-2">
          <table className="tbl">
            <thead>
              <tr>
                <th>Pool</th>
                <th>Range</th>
                <th>Status</th>
                <th>Holds</th>
                <th>Fees owed</th>
                <th>Value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lp.data?.positions.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted">
                    No v3 positions. Open one from any pool&rsquo;s LP Lab.
                  </td>
                </tr>
              )}
              {lp.data?.positions.map((p) => (
                <tr key={p.tokenId}>
                  <td className="font-semibold">
                    {p.pool ? (
                      <Link href={`/t/${p.pool}`} className="hover:text-pen">
                        {p.symbol0}/{p.symbol1}
                      </Link>
                    ) : (
                      `${p.symbol0}/${p.symbol1}`
                    )}{' '}
                    <span className="pill">{(p.fee / 10_000).toFixed(2)}%</span>
                  </td>
                  <td className="text-muted">
                    {p.tickLower} → {p.tickUpper}
                  </td>
                  <td>
                    <span className={`pill ${p.inRange ? 'pill-up' : 'pill-warn'}`}>{p.currentTick === null ? 'unknown' : p.inRange ? 'in range' : 'out of range'}</span>
                  </td>
                  <td className="text-muted">
                    {formatQty(BigInt(p.amount0), p.decimals0)} / {formatQty(BigInt(p.amount1), p.decimals1)}
                  </td>
                  <td className="text-muted">
                    {formatQty(BigInt(p.owed0), p.decimals0)} / {formatQty(BigInt(p.owed1), p.decimals1)}
                  </td>
                  <td className="font-semibold">{p.valueQuote !== null ? `${p.valueQuote.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${p.quoteSymbol}` : '—'}</td>
                  <td>
                    <LpActions p={p} hasFees={BigInt(p.owed0) > 0n || BigInt(p.owed1) > 0n} hasLiquidity={BigInt(p.liquidity) > 0n} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-faint">
        Every action is one signature from your wallet, straight to the Uniswap contracts — nothing is custodied here. Fees owed here are
        exact; &ldquo;Holds&rdquo; is what the position would hand back at this second&rsquo;s price.
      </p>
    </div>
  )
}

