import Link from 'next/link'
import { EXPLORER_URL } from '@paperhands/chain'
import type { Alert } from '@/lib/alerts'

const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d })

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

export default function AlertsFeed({ alerts }: { alerts: Alert[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="label">Alerts</span>
        <span className="text-[12px] text-faint">liquidity pulled · dumps · volume surges</span>
      </div>
      {alerts.length === 0 ? (
        <p className="px-5 pb-5 pt-2 text-[13.5px] text-muted">Quiet. Nothing has dumped, drained or surged in the last few hours.</p>
      ) : (
        <ul className="divide-y divide-line px-2 pb-2 pt-2">
          {alerts.map((a) => (
            <li key={`${a.kind}:${a.pool}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13.5px]">
              {a.kind === 'pull' && <span className="pill pill-warn">liquidity pulled</span>}
              {a.kind === 'dump' && <span className="pill pill-down">dump</span>}
              {a.kind === 'surge' && <span className="pill pill-up">surge</span>}
              <Link href={`/t/${a.pool}`} className="font-semibold hover:text-pen">
                {a.symbol}
              </Link>
              <span className="text-muted">
                {a.kind === 'pull' && (
                  <>
                    ~{fmt(a.pulledPct, 0)}% of active depth removed in one tx ·{' '}
                    <a className="hover:text-pen" href={`${EXPLORER_URL}/tx/${a.txHash}`} target="_blank" rel="noreferrer">
                      block {a.block.toLocaleString()} ↗
                    </a>
                  </>
                )}
                {a.kind === 'dump' && (
                  <>
                    {fmt(a.changePct, 0)}% in 3h · {fmt(a.depth)} {a.quoteSymbol} of exit depth left · {fmt(a.vol24)} {a.quoteSymbol} traded 24h
                  </>
                )}
                {a.kind === 'surge' && (
                  <>
                    {a.ratio >= 99 ? 'from nothing' : `${fmt(a.ratio, 0)}× last half hour`} · {fmt(a.vol30, 2)} {a.quoteSymbol} in 30m
                  </>
                )}
              </span>
              <span className="ml-auto text-[12px] text-faint">{ago(a.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
