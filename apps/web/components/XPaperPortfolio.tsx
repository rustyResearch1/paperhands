'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { formatQty, formatUsd } from '@/lib/format'
import { CHAIN_LABEL, NATIVE, type XChain } from '@/lib/x/types'

interface Valued {
  token: string
  symbol: string
  decimals: number
  qty: string
  costNative: string
  realizedNative: string
  realizable: string | null
  source?: string
}
interface State {
  chain: 'sol' | 'bsc'
  native: string
  positions: Valued[]
  valued: Valued[]
  equity: string
  error?: string
}

/** Paper positions on Solana and BNB Chain, valued at what the venue would pay. */
export default function XPaperPortfolio() {
  const prices = useQuery({ queryKey: ['xprice'], queryFn: async () => (await fetch('/api/v1/xprice')).json() as Promise<Record<XChain, number | null>>, refetchInterval: 60_000 })
  return (
    <div className="space-y-5">
      {(['sol', 'bsc'] as const).map((chain) => (
        <PaperChain key={chain} chain={chain} nativeUsd={prices.data?.[chain] ?? null} />
      ))}
    </div>
  )
}

function PaperChain({ chain, nativeUsd }: { chain: 'sol' | 'bsc'; nativeUsd: number | null }) {
  const native = NATIVE[chain]
  const q = useQuery({ queryKey: ['xpaper', chain], queryFn: async () => (await fetch(`/api/xpaper?chain=${chain}`)).json() as Promise<State>, refetchInterval: 30_000 })
  // /api/xpaper answers 401 with {error} for an ephemeral session (cookie-less
  // client, or the ledger-busy fallback): treat the error body as a state, not data.
  const s = q.data && !q.data.error && Array.isArray(q.data.valued) ? q.data : null
  const problem = q.data?.error ?? (q.isError ? 'Could not reach the paper ledger.' : null)
  const usd = (raw: bigint) => (nativeUsd ? formatUsd((Number(raw) / 10 ** native.decimals) * nativeUsd) : null)
  const open = s?.valued.filter((p) => BigInt(p.qty) > 0n) ?? []
  const closed = s?.positions.filter((p) => BigInt(p.qty) === 0n && p.realizedNative !== '0') ?? []
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <span className="label">{CHAIN_LABEL[chain]} · paper</span>
        {problem && <span className="text-[12.5px] text-muted">{problem}</span>}
        {s && !s.error && (
          <span className="num text-[13px]">
            equity{' '}
            <span className="hilite">
              {formatQty(BigInt(s.equity), native.decimals)} {native.symbol}
            </span>
            {usd(BigInt(s.equity)) ? <span className="ml-2 text-muted">{usd(BigInt(s.equity))}</span> : null}
            <span className="ml-3 text-muted">
              cash {formatQty(BigInt(s.native), native.decimals)} {native.symbol}
            </span>
          </span>
        )}
      </div>
      <div className="overflow-x-auto px-2 pb-2 pt-2">
        <table className="tbl">
          <thead>
            <tr>
              <th>Position</th>
              <th>Qty</th>
              <th>Cost</th>
              <th>Venue would pay</th>
              <th>P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {open.map((p) => {
              const cost = BigInt(p.costNative)
              const real = p.realizable ? BigInt(p.realizable) : null
              const pnl = real !== null ? real - cost : null
              return (
                <tr key={p.token}>
                  <td className="font-semibold">
                    <Link href={`/x/${chain}/${p.token}`} className="hover:text-pen">
                      {p.symbol}
                    </Link>
                  </td>
                  <td className="text-muted">{formatQty(BigInt(p.qty), p.decimals)}</td>
                  <td className="text-muted">
                    {formatQty(cost, native.decimals)} {native.symbol}
                  </td>
                  <td className="font-semibold">
                    {real !== null ? (
                      <span className="hilite">
                        {formatQty(real, native.decimals)} {native.symbol}
                      </span>
                    ) : (
                      <span className="text-faint">no route</span>
                    )}
                  </td>
                  <td className={pnl === null ? 'text-faint' : pnl >= 0n ? 'text-up' : 'text-down'}>
                    {pnl === null ? '—' : `${pnl >= 0n ? '+' : ''}${formatQty(pnl, native.decimals)} ${native.symbol}`}
                  </td>
                </tr>
              )
            })}
            {closed.slice(0, 5).map((p) => (
              <tr key={`c:${p.token}`} className="text-muted">
                <td>{p.symbol} · closed</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td className={BigInt(p.realizedNative) >= 0n ? 'text-up' : 'text-down'}>
                  {BigInt(p.realizedNative) >= 0n ? '+' : ''}
                  {formatQty(BigInt(p.realizedNative), native.decimals)} {native.symbol} realized
                </td>
              </tr>
            ))}
            {s && open.length === 0 && closed.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted">
                  No paper positions yet. Start with {formatQty(BigInt(s.native), native.decimals)} {native.symbol} on any{' '}
                  <Link href={`/x/${chain}`} className="text-pen hover:underline">
                    {CHAIN_LABEL[chain]} token
                  </Link>
                  .
                </td>
              </tr>
            )}
            {q.isLoading && (
              <tr>
                <td colSpan={5} className="text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
