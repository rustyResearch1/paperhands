const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉'

/** 0.0000032175 → "0.0₅3217" — the compact deep-decimal notation traders read fluently. */
export function formatPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '—'
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 0.01) return p.toPrecision(4)
  const zeros = Math.floor(-Math.log10(p)) - 1
  if (zeros <= 2) return p.toPrecision(4)
  const digits = Math.round(p * 10 ** (zeros + 5))
    .toString()
    .slice(0, 4)
  const sub = String(zeros)
    .split('')
    .map((c) => SUBSCRIPTS[Number(c)])
    .join('')
  return `0.0${sub}${digits}`
}

export function formatEth(wei: bigint, digits = 4): string {
  const eth = Number(wei) / 1e18
  if (Math.abs(eth) >= 1000) return eth.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return eth.toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function formatQty(raw: bigint, decimals: number): string {
  const v = Number(raw) / 10 ** decimals
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)}K`
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function formatPct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '—'
  const sign = x > 0 ? '+' : ''
  return `${sign}${x.toFixed(digits)}%`
}

export function formatBps(bps: number): string {
  if (!Number.isFinite(bps)) return '—'
  if (bps >= 100) return `${(bps / 100).toFixed(2)}%`
  return `${bps.toFixed(1)}bps`
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
