import { ALERTS_META_KEY, ALERTS_TS_KEY, computeAlerts, type Alert } from '@paperhands/indexer'
import { db } from './db'

export type { Alert }

/** How old the indexer's stored alerts may be before we compute live. */
const FRESH_S = 15 * 60
const MAX = 100
let cached: { at: number; alerts: Alert[] } | null = null

/**
 * Alerts come from the snapshot the watch loop stores every minute; the live
 * computation (tens of seconds on a full ledger) is only the fallback for a
 * fresh database or a stalled indexer, cached per process.
 */
export function marketAlerts(limit = 30): Alert[] {
  const stored = storedAlerts()
  if (stored) return stored.slice(0, Math.min(limit, MAX))
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), alerts: computeAlerts(db, MAX) }
  return cached.alerts.slice(0, Math.min(limit, MAX))
}

function storedAlerts(): Alert[] | null {
  try {
    const ts = Number((db.prepare(`SELECT value FROM meta WHERE key = ?`).get(ALERTS_TS_KEY) as { value: string } | undefined)?.value ?? 0)
    if (!ts || Math.floor(Date.now() / 1000) - ts > FRESH_S) return null
    const json = (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(ALERTS_META_KEY) as { value: string } | undefined)?.value
    return json ? (JSON.parse(json) as Alert[]) : null
  } catch {
    return null
  }
}
