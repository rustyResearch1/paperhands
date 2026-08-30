import { cookies } from 'next/headers'
import { db } from './db'

const STARTING_BANKROLL_WEI = (10n * 10n ** 18n).toString() // 10 paper ETH

export interface UserRow {
  id: string
  handle: string | null
  created_ts: number
  balance_quote: string
}

export async function getOrCreateUser(): Promise<UserRow> {
  const jar = await cookies()
  const id = jar.get('ph_user')?.value
  if (!id) {
    // Build-time render or a cookie-less client: an ephemeral identity that is
    // never persisted — a shared 'anonymous' DB row would be one bankroll
    // tradeable by every cookie-less request.
    return { id: '__ephemeral', handle: null, created_ts: 0, balance_quote: STARTING_BANKROLL_WEI }
  }
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
}
