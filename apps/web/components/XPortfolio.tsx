'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo } from 'react'
import { erc20Abi } from '@paperhands/chain'
import type { Address } from 'viem'
import { useAccount, useBalance, useConnect, useReadContracts } from 'wagmi'
import { formatQty, formatUsd } from '@/lib/format'
import { useSolana } from '@/lib/solana'
import { solBalanceLamports, splHoldings } from '@/lib/solbalance'
import { NATIVE } from '@/lib/x/types'

const BSC_ID = 56 as const
/** Tokens every BNB Chain wallet is checked for, plus whatever was traded here. */
const BSC_STAPLES: { address: Address; symbol: string; decimals: number }[] = [
  { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 },
  { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 },
  { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE', decimals: 18 },
  { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', decimals: 18 },
  { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB', decimals: 18 },
]
export const BSC_TRADED_KEY = 'ph_bsc_tokens'

interface ValueRow {
  token: string
  amount: string
  symbol: string
  decimals: number
  realizable: string | null
  fillRatio?: number
  source?: string
  error?: string
}

async function value(chain: 'sol' | 'bsc', holdings: { token: string; amount: string }[]): Promise<ValueRow[]> {
  if (holdings.length === 0) return []
  const r = (await (await fetch('/api/v1/xvalue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain, holdings }) })).json()) as { rows?: ValueRow[] }
  return r.rows ?? []
}

/** Solana + BNB Chain holdings, each bag valued at what the venue would pay for all of it right now. */
export default function XPortfolio() {
  const prices = useQuery({ queryKey: ['xprice'], queryFn: async () => (await fetch('/api/v1/xprice')).json() as Promise<{ sol: number | null; bsc: number | null }>, refetchInterval: 60_000 })
  return (
    <div className="space-y-5">
      <SolanaHoldings solUsd={prices.data?.sol ?? null} />
      <BscHoldings bnbUsd={prices.data?.bsc ?? null} />
      <LpPositions solUsd={prices.data?.sol ?? null} bnbUsd={prices.data?.bsc ?? null} />
    </div>
  )
}

interface SolPos {
  address: string
  name: string
  tokenA: { mint: string; symbol: string }
  tokenB: { mint: string; symbol: string }
  tickLower: number
  tickUpper: number
  inRange: boolean
  valueSol: number | null
  feeOwedA: string
  feeOwedB: string
  feeRate: number
}
interface BscPos {
  tokenId: string
  token0: string
  token1: string
  symbol0: string
  symbol1: string
  fee: number
  tickLower: number
  tickUpper: number
  currentTick: number | null
  inRange: boolean
  valueBnb: number | null
  owed0: string
  owed1: string
}

/** Concentrated-liquidity positions on Solana (Orca) and BNB Chain (PancakeSwap v3) — manage them from the token page. */
function LpPositions({ solUsd, bnbUsd }: { solUsd: number | null; bnbUsd: number | null }) {
  const sol = useSolana()
  const { address } = useAccount()
  const orca = useQuery({
    queryKey: ['sollp', 'positions', sol.publicKey],
    queryFn: async () => (await fetch(`/api/lp/sol?owner=${sol.publicKey}`)).json() as Promise<{ positions: SolPos[]; error?: string }>,
    enabled: Boolean(sol.publicKey),
    refetchInterval: 60_000,
  })
  const pancake = useQuery({
    queryKey: ['bsclp', 'positions', address],
    queryFn: async () => (await fetch(`/api/lp/bsc?owner=${address}`)).json() as Promise<{ positions: BscPos[]; error?: string }>,
    enabled: Boolean(address),
    refetchInterval: 60_000,
  })
  const solRows = orca.data?.positions ?? []
  const bscRows = pancake.data?.positions ?? []
  if (!sol.publicKey && !address) return null
  const wbnb = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
  const solMint = 'So11111111111111111111111111111111111111112'
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="label">LP positions · other chains</span>
        <span className="text-[12px] text-faint">Orca Whirlpools · PancakeSwap v3 · manage from the token page</span>
      </div>
      <div className="overflow-x-auto px-2 pb-2 pt-2">
        <table className="tbl">
          <thead>
            <tr>
              <th>Pool</th>
              <th>Range</th>
              <th>Status</th>
              <th>Value</th>
              <th className="hidden md:table-cell">Fees owed</th>
            </tr>
          </thead>
          <tbody>
            {solRows.map((p) => {
              const other = p.tokenA.mint === solMint ? p.tokenB.mint : p.tokenA.mint
              return (
                <tr key={`sol:${p.address}`}>
                  <td className="font-semibold">
                    <Link href={`/x/sol/${other}`} className="hover:text-pen">
                      {p.name}
                    </Link>{' '}
                    <span className="pill">Solana · {(p.feeRate / 10_000).toFixed(2)}%</span>
                  </td>
                  <td className="text-muted">
                    {p.tickLower} → {p.tickUpper}
                  </td>
                  <td>
                    <span className={`pill ${p.inRange ? 'pill-up' : 'pill-warn'}`}>{p.inRange ? 'in range' : 'out of range'}</span>
                  </td>
                  <td className="font-semibold">{p.valueSol !== null ? `${p.valueSol.toFixed(4)} SOL${solUsd ? ` · ${formatUsd(p.valueSol * solUsd)}` : ''}` : '—'}</td>
                  <td className="hidden text-muted md:table-cell">{BigInt(p.feeOwedA) > 0n || BigInt(p.feeOwedB) > 0n ? 'yes' : '—'}</td>
                </tr>
              )
            })}
            {bscRows.map((p) => {
              const other = p.token0 === wbnb ? p.token1 : p.token0
              return (
                <tr key={`bsc:${p.tokenId}`}>
                  <td className="font-semibold">
                    <Link href={`/x/bsc/${other}`} className="hover:text-pen">
                      {p.symbol0}/{p.symbol1}
                    </Link>{' '}
                    <span className="pill">BNB Chain · {(p.fee / 10_000).toFixed(2)}%</span>
                  </td>
                  <td className="text-muted">
                    {p.tickLower} → {p.tickUpper}
                  </td>
                  <td>
                    <span className={`pill ${p.inRange ? 'pill-up' : 'pill-warn'}`}>{p.currentTick === null ? 'unknown' : p.inRange ? 'in range' : 'out of range'}</span>
                  </td>
                  <td className="font-semibold">{p.valueBnb !== null ? `${p.valueBnb.toFixed(4)} BNB${bnbUsd ? ` · ${formatUsd(p.valueBnb * bnbUsd)}` : ''}` : '—'}</td>
                  <td className="hidden text-muted md:table-cell">{BigInt(p.owed0) > 0n || BigInt(p.owed1) > 0n ? 'yes' : '—'}</td>
                </tr>
              )
            })}
            {solRows.length === 0 && bscRows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted">
                  {orca.isLoading || pancake.isLoading ? 'Reading positions…' : 'No Orca or PancakeSwap v3 positions in the connected wallets.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SolanaHoldings({ solUsd }: { solUsd: number | null }) {
  const sol = useSolana()
  const holdings = useQuery({
    queryKey: ['xpf', 'sol', sol.publicKey],
    queryFn: async () => {
      const [lamports, spl] = await Promise.all([solBalanceLamports(sol.publicKey!), splHoldings(sol.publicKey!)])
      const top = spl.sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, 15)
      const rows = await value('sol', top.map((h) => ({ token: h.mint, amount: h.amount.toString() })))
      return { lamports, rows }
    },
    enabled: Boolean(sol.publicKey),
    refetchInterval: 60_000,
  })
  return (
    <Holdings
      title="Solana"
      native={NATIVE.sol}
      nativeUsd={solUsd}
      connected={Boolean(sol.publicKey)}
      connectLabel={sol.available ? `Connect ${sol.walletName}` : 'Install Phantom'}
      onConnect={() => sol.connect().catch(() => {})}
      nativeBalance={holdings.data?.lamports ?? null}
      rows={holdings.data?.rows ?? []}
      loading={holdings.isLoading}
      hrefFor={(t) => `/x/sol/${t}`}
      note="Valued by Jupiter: a full-size sell quote per bag, routed across every Solana DEX."
    />
  )
}

function BscHoldings({ bnbUsd }: { bnbUsd: number | null }) {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const traded = useMemo<{ address: Address; symbol: string; decimals: number }[]>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(BSC_TRADED_KEY) : null
      return raw ? (JSON.parse(raw) as { address: Address; symbol: string; decimals: number }[]) : []
    } catch {
      return []
    }
  }, [])
  const tokens = useMemo(() => {
    const seen = new Set<string>()
    return [...BSC_STAPLES, ...traded].filter((t) => (seen.has(t.address.toLowerCase()) ? false : (seen.add(t.address.toLowerCase()), true)))
  }, [traded])
  const bnb = useBalance({ address, chainId: BSC_ID, query: { enabled: Boolean(address), refetchInterval: 30_000 } })
  const balances = useReadContracts({
    contracts: tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address!] as const, chainId: BSC_ID })),
    query: { enabled: Boolean(address), refetchInterval: 30_000 },
  })
  const held = useMemo(() => {
    const out: { token: string; amount: string; symbol: string; decimals: number }[] = []
    balances.data?.forEach((r, i) => {
      const v = r.status === 'success' ? (r.result as bigint) : 0n
      if (v > 0n) out.push({ token: tokens[i]!.address, amount: v.toString(), symbol: tokens[i]!.symbol, decimals: tokens[i]!.decimals })
    })
    return out
  }, [balances.data, tokens])
  const valued = useQuery({
    queryKey: ['xpf', 'bsc', address, held.map((h) => `${h.token}:${h.amount}`).join('|')],
    queryFn: () => value('bsc', held),
    enabled: Boolean(address) && held.length > 0,
    refetchInterval: 60_000,
  })
  return (
    <Holdings
      title="BNB Chain"
      native={NATIVE.bsc}
      nativeUsd={bnbUsd}
      connected={isConnected && Boolean(address)}
      connectLabel="Connect wallet"
      onConnect={() => {
        const c = connectors.find((x) => x.id === 'injected') ?? connectors[0]
        if (c) connect({ connector: c })
      }}
      nativeBalance={bnb.data?.value ?? null}
      rows={valued.data ?? held.map((h) => ({ ...h, realizable: null }))}
      loading={balances.isLoading || valued.isLoading}
      hrefFor={(t) => `/x/bsc/${t}`}
      note="Valued by our exact engine on PancakeSwap v3, or KyberSwap when it pays more. Staples plus anything you traded here."
    />
  )
}

function Holdings(props: {
  title: string
  native: { symbol: string; decimals: number }
  nativeUsd: number | null
  connected: boolean
  connectLabel: string
  onConnect: () => void
  nativeBalance: bigint | null
  rows: ValueRow[]
  loading: boolean
  hrefFor: (token: string) => string
  note: string
}) {
  const { native, nativeUsd, rows } = props
  const realizableTotal = rows.reduce((a, r) => a + (r.realizable ? BigInt(r.realizable) : 0n), 0n) + (props.nativeBalance ?? 0n)
  const usd = (raw: bigint) => (nativeUsd ? formatUsd((Number(raw) / 10 ** native.decimals) * nativeUsd) : null)
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <span className="label">{props.title}</span>
        {props.connected ? (
          <span className="num text-[13px]">
            <span className="hilite">
              {formatQty(realizableTotal, native.decimals)} {native.symbol}
            </span>
            {usd(realizableTotal) ? <span className="ml-2 text-muted">{usd(realizableTotal)}</span> : null}
          </span>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={props.onConnect}>
            {props.connectLabel}
          </button>
        )}
      </div>
      {props.connected && (
        <div className="overflow-x-auto px-2 pb-2 pt-2">
          <table className="tbl">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Balance</th>
                <th>Venue would pay</th>
                <th className="hidden md:table-cell">Quoted by</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold">{native.symbol}</td>
                <td>{props.nativeBalance !== null ? formatQty(props.nativeBalance, native.decimals) : '…'}</td>
                <td className="font-semibold">{props.nativeBalance !== null ? `${formatQty(props.nativeBalance, native.decimals)} ${native.symbol}` : '…'}</td>
                <td className="hidden text-muted md:table-cell">native</td>
              </tr>
              {rows.map((r) => (
                <tr key={r.token}>
                  <td className="font-semibold">
                    <Link href={props.hrefFor(r.token)} className="hover:text-pen">
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="text-muted">{formatQty(BigInt(r.amount), r.decimals)}</td>
                  <td className={r.realizable ? 'font-semibold' : 'text-faint'}>
                    {r.realizable ? (
                      <>
                        <span className="hilite">
                          {formatQty(BigInt(r.realizable), native.decimals)} {native.symbol}
                        </span>
                        {r.fillRatio !== undefined && r.fillRatio < 0.999 ? <span className="ml-1 text-down">partial</span> : null}
                      </>
                    ) : r.error ? (
                      'no route'
                    ) : (
                      '…'
                    )}
                  </td>
                  <td className="hidden text-muted md:table-cell">{r.source === 'engine' ? 'engine · exact' : r.source === 'jupiter' ? 'Jupiter' : r.source === 'kyberswap' ? 'KyberSwap' : '—'}</td>
                </tr>
              ))}
              {props.loading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted">
                    Reading wallet…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 pb-4 pt-1 text-[12px] text-faint">{props.note}</p>
    </div>
  )
}
