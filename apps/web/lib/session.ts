import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { db } from './db'

const STARTING_BANKROLL_WEI = (10n * 10n ** 18n).toString() // 10 paper ETH

export interface UserRow {
  id: string
  handle: string | null
  created_ts: number
  balance_quote: string
}

function sig(id: string, secret: string): string {
  return createHmac('sha256', secret).update(id).digest('hex').slice(0, 24)
}

/**
 * Resolve the cookie to a trusted user id, or null.
 * - `v1.<uuid>.<sig>` tokens verify against PAPERHANDS_SECRET.
 * - Bare uuids are accepted when no secret is configured (dev), and — as a
 *   migration grace — when the secret IS configured but the row already
 *   exists (cookies minted before signing shipped).
 */
export function verifyToken(token: string | undefined): string | null {
  if (!token) return null
  const secret = process.env.PAPERHANDS_SECRET
  const m = token.match(/^v1\.([0-9a-f-]{36})\.([0-9a-f]{24})$/)
  if (m) {
    if (!secret) return null
    const want = Buffer.from(sig(m[1]!, secret))
    const got = Buffer.from(m[2]!)
    return want.length === got.length && timingSafeEqual(want, got) ? m[1]! : null
  }
  if (!/^[0-9a-f-]{36}$/.test(token)) return null
  if (!secret) return token
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(token)
  return exists ? token : null
}

/** The token for the current user — this IS the account key a user can save. */
export function mintToken(id: string): string {
  const secret = process.env.PAPERHANDS_SECRET
  return secret ? `v1.${id}.${sig(id, secret)}` : id
}

export async function getOrCreateUser(): Promise<UserRow> {
  const jar = await cookies()
  const id = verifyToken(jar.get('ph_user')?.value)
  if (!id) {
    // Build-time render, cookie-less client, or a forged/invalid token: an
    // ephemeral identity that is never persisted.
    return { id: '__ephemeral', handle: null, created_ts: 0, balance_quote: STARTING_BANKROLL_WEI }
  }
  try {
    let row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
    if (!row) {
      db.prepare('INSERT OR IGNORE INTO users(id, handle, created_ts, balance_quote) VALUES(?, NULL, ?, ?)').run(
        id,
        Math.floor(Date.now() / 1000),
        STARTING_BANKROLL_WEI,
      )
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow
    }
    return row
  } catch (err) {
    // The ledger is momentarily locked by the indexer: render the page with a
    // read-only identity rather than a 500. Trades retry on the next request.
    console.warn('session: ledger busy, serving ephemeral identity —', (err as Error).message)
    return { id: '__ephemeral', handle: null, created_ts: 0, balance_quote: STARTING_BANKROLL_WEI }
  }
}
