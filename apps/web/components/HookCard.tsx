import { EXPLORER_URL } from '@paperhands/chain'
import type { HookProfile } from '@/lib/hooks'

const TONE: Record<string, string> = { up: 'pill-up', warn: 'pill-warn', down: 'pill-down', neutral: '' }
const RISK: Record<HookProfile['risk'], string> = { low: 'pill-up', medium: 'pill-warn', high: 'pill-down' }

/** What a v4 hook can do to you, decoded from its address bits — no source needed. */
export default function HookCard({ hook }: { hook: HookProfile }) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label">Hook</span>
        <span className={`pill ${RISK[hook.risk]}`}>{hook.risk} risk</span>
      </div>
      <p className="mt-2 text-[13.5px] text-muted">{hook.riskWhy}</p>
      <ul className="mt-3 space-y-2">
        {hook.capabilities.map((c) => (
          <li key={c.label} className="text-[13.5px]">
            <span className={`pill ${TONE[c.tone]}`}>{c.label}</span>
            <div className="mt-1 text-[12.5px] text-muted">{c.why}</div>
          </li>
        ))}
        {hook.capabilities.length === 0 && <li className="text-[13.5px] text-muted">No permission bits set — an inert hook address.</li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-1">
        {hook.flags.map((f) => (
          <span key={f.key} className="chip">
            {f.label}
          </span>
        ))}
        {hook.dynamicFee && <span className="chip">dynamic fee</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-faint">
        <span>
          used by {hook.poolCount.toLocaleString()} pools · {hook.swapCount.toLocaleString()} swaps
        </span>
        <a className="num hover:text-pen" href={`${EXPLORER_URL}/address/${hook.address}`} target="_blank" rel="noreferrer">
          {hook.address.slice(0, 6)}…{hook.address.slice(-4)} ↗
        </a>
      </div>
    </div>
  )
}
