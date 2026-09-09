const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉'

/**
 * 0.0000032175 → "0.0₅3218" — the compact deep-decimal notation traders read
 * fluently: the subscript is the total count of zeros after the decimal point,
 * followed by the four significant digits, rounded.
 */
export function formatPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '—'
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 0.01) return p.toPrecision(4)
  // p ∈ [10^-(zeros+1), 10^-zeros) has exactly `zeros` zeros after the point
  let zeros = Math.ceil(-Math.log10(p)) - 1
  let mantissa = Math.round(p * 10 ** (zeros + 4))
  if (mantissa >= 10000) {
    // rounding carried into the next magnitude (e.g. 0.0000099995 → 0.0₄1000)
    mantissa = Math.round(mantissa / 10)
    zeros -= 1
  }
  if (zeros <= 2) return p.toPrecision(4)
  const sub = String(zeros)
    .split('')
    .map((c) => SUBSCRIPTS[Number(c)])
    .join('')
  return `0.0${sub}${mantissa}`
}

/** Dollar formatting across twelve orders of magnitude: $0.0₅1234 to $106M. */
export function formatUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 10_000) return `$${(v / 1000).toFixed(1)}K`
  if (v >= 1) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  return `$${formatPrice(v)}`
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

// ---------------------------------------------------------------------------
// The helpers below were re-implemented locally on a dozen pages, each with its
// own decimal count and sign rule, which is why the same wallet's numbers read
// differently on the Wire, the Tape and its own page.

/** A plain number in ETH units (not wei), e.g. 1.234. */
export function formatEthNum(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}

/** Always carries its sign — for P&L, flows and deltas. */
export function signed(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${formatEthNum(n, digits)}`
}

/** Token quantities in human units: 3.31M, 10.6K, 536. */
export function formatQtyNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: a < 10 ? 2 : 0 })
}

/** 0x4337…b6c2 — one address shortening for the whole app. */
export function shortAddr(address: string, lead = 6, tail = 4): string {
  if (!address) return ''
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

/** A duration in seconds: 45s, 12m, 3.4h, 2.1d. */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86_400) return `${(sec / 3600).toFixed(1)}h`
  return `${(sec / 86_400).toFixed(1)}d`
}
