import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getOrCreateUser } from '@/lib/session'

export async function POST(req: NextRequest) {
  const user = await getOrCreateUser()
  let handle: string
  try {
    handle = String((await req.json()).handle ?? '').trim()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }
  if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(handle)) {
    return NextResponse.json(
      { ok: false, error: '2–24 chars: letters, numbers, _ . -' },
      { status: 422 },
    )
  }
  if (user.id === '__ephemeral') {
    return NextResponse.json({ ok: false, error: 'No session yet — reload the page and try again.' }, { status: 401 })
  }
  try {
    const r = db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, user.id)
    if (r.changes !== 1) return NextResponse.json({ ok: false, error: 'No session yet — reload the page and try again.' }, { status: 401 })
  } catch (err) {
    const msg = (err as Error).message
    if (/UNIQUE/i.test(msg)) return NextResponse.json({ ok: false, error: 'That handle is taken.' }, { status: 409 })
    if (/SQLITE_BUSY|database is locked/i.test(msg)) {
      return NextResponse.json({ ok: false, error: 'The ledger is busy — try again in a moment.' }, { status: 503 })
    }
    return NextResponse.json({ ok: false, error: 'Could not save that handle.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
