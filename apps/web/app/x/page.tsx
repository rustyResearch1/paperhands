import Link from 'next/link'
import { formatUsd } from '@/lib/format'
import { compareAcrossChains } from '@/lib/x/compare'
import { CHAIN_LABEL, NATIVE, type XChain } from '@/lib/x/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Best execution' }

const SIZES = [100, 500, 2000, 10_000]
const CHAINS: XChain[] = ['rh', 'sol', 'bsc']

export default async function BestExecution({ searchParams }: { searchParams: Promise<{ usd?: string }> }) {
  const { usd: usdRaw } = await searchParams
  const usd = SIZES.includes(Number(usdRaw)) ? Number(usdRaw) : 500
  const { rows, nativeUsd } = await compareAcrossChains(usd)

  return (
    <div className="space-y-5">
      <div className="rise">
        <h1 className="text-[28px] font-semibold tracking-tight">Best execution</h1>
        <p className="max-w-3xl text-muted">
          The same {formatUsd(usd)} into the same asset on every chain, quoted live — Robinhood Chain and PancakeSwap through our exact engine,
          Solana through Jupiter, KyberSwap when it fills better on BNB Chain. Cost is what you lose to fees, impact and spread on the way in; gas is on top.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {SIZES.map((s) => (
          <Link key={s} href={`/x?usd=${s}`} className={`chip ${usd === s ? 'chip-active' : ''}`}>
            {formatUsd(s)}
          </Link>
        ))}
        <span className="ml-2 text-[12px] text-faint">
          {CHAINS.map((c) => `${NATIVE[c].symbol} ${nativeUsd[c] ? formatUsd(nativeUsd[c]!) : '—'}`).join(' · ')}
        </span>
      </div>

      <div className="card rise rise-2 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Asset</th>
                {CHAINS.map((c) => (
                  <th key={c}>{CHAIN_LABEL[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.asset.key}>
                  <td className="font-semibold">{r.asset.label}</td>
                  {r.cells.map((c) => (
                    <td key={c.chain} className={`align-top ${r.best === c.chain ? 'bg-up-soft/40' : ''}`}>
                      {c.token === null ? (
                        <span className="text-faint">not listed</span>
                      ) : c.native ? (
                        <span className="text-muted">native asset · no swap needed</span>
                      ) : c.error ? (
                        <span className="text-down">{c.error}</span>
                      ) : (
                        <div className="text-left">
                          <div className={`num font-semibold ${r.best === c.chain ? 'text-up' : ''}`}>
                            {c.costBps !== undefined ? (c.costBps >= 0 ? `cost ${c.costBps.toFixed(0)} bps` : `edge ${(-c.costBps).toFixed(0)} bps`) : '—'}
                            {r.best === c.chain ? ' · best' : ''}
                          </div>
                          <div className="text-[12px] text-muted">
                            get {c.valueUsd !== undefined ? formatUsd(c.valueUsd) : '—'}
                            {c.symbol ? ` of ${c.symbol}` : ''} · impact {c.impactBps === null || c.impactBps === undefined ? '—' : `${c.impactBps.toFixed(0)} bps`} · gas{' '}
                            {c.gasUsd === null || c.gasUsd === undefined ? (c.chain === 'sol' ? '<$0.01' : '≈$0.01') : formatUsd(c.gasUsd)}
                          </div>
                          <div className="max-w-[16rem] truncate text-[11.5px] text-faint" title={c.route}>
                            {c.source === 'engine' ? 'engine · exact' : c.source === 'jupiter' ? 'Jupiter' : 'KyberSwap'} · {c.route}
                          </div>
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-faint">
        Cost = 1 − (USD value received ÷ USD spent) at current prices (Jupiter / GeckoTerminal / our ledger). Wrapped assets differ per chain (cbBTC vs BTCB, Wormhole ETH vs
        Binance-peg ETH): same exposure, different issuers — not fungible across chains without a bridge. Sizes are sized in each chain&rsquo;s native asset at spot.
      </p>
    </div>
  )
}
