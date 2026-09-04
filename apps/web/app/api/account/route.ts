import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateUser, mintToken, verifyToken } from '@/lib/session'

/** GET → the account key (save it somewhere safe; it IS the account). */
export async function GET() {
  const user = await getOrCreateUser()
  if (user.id === '__ephemeral') return NextResponse.json({ error: 'no session' }, { status: 401 })
  return NextResponse.json({ key: mintToken(user.id) })
}

/** POST {key} → restore the account this key belongs to onto this browser. */
export async function POST(req: NextRequest) {
  let key: string
  try {
    key = String((await req.json()).key ?? '').trim()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }
  const id = verifyToken(key)
  if (!id) return NextResponse.json({ ok: false, error: 'That key is not valid.' }, { status: 422 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set('ph_user', key, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365 * 2,
    path: '/',
  })
  return res
}
