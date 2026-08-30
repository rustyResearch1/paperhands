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
  // middleware guarantees the cookie on real requests; build-time renders get a throwaway id
  const id = jar.get('ph_user')?.value ?? 'anonymous'
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
