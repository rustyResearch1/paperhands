import { NextResponse, type NextRequest } from 'next/server'

/** Every visitor gets a paper-trading identity cookie; the DB row is created lazily server-side. */
export function middleware(request: NextRequest) {
  if (request.cookies.has('ph_user')) return NextResponse.next()
  const response = NextResponse.next()
  response.cookies.set('ph_user', crypto.randomUUID(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  })
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
