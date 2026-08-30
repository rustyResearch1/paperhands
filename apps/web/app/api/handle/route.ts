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
  try {
    db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, user.id)
  } catch {
    return NextResponse.json({ ok: false, error: 'That handle is taken.' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
