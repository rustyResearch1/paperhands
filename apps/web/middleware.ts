import { NextResponse, type NextRequest } from 'next/server'

/**
 * Every visitor gets a paper-trading identity cookie. With PAPERHANDS_SECRET
 * set, the id is HMAC-signed (format v1.<uuid>.<sig>) so identities cannot be
 * forged by writing an arbitrary cookie; without it (local dev) a bare uuid
 * is minted. The DB row is created lazily server-side.
 */
export async function middleware(request: NextRequest) {
  if (request.cookies.has('ph_user')) return NextResponse.next()
  const id = crypto.randomUUID()
  const secret = process.env.PAPERHANDS_SECRET
  let value = id
  if (secret) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id)))
    const sig = [...mac.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
    value = `v1.${id}.${sig}`
  }
  const response = NextResponse.next()
  response.cookies.set('ph_user', value, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365 * 2,
    path: '/',
  })
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
