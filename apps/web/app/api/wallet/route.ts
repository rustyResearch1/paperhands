import { NextRequest, NextResponse } from 'next/server'
import { walletHoldings, walletLpPositions } from '@/lib/real'

export const maxDuration = 60

/** Read-only view of a real wallet: holdings valued by pool-would-pay, and v3 LP positions. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  const what = req.nextUrl.searchParams.get('what') ?? 'holdings'
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) return NextResponse.json({ error: 'address required' }, { status: 400 })
  try {
    if (what === 'lp') return NextResponse.json({ positions: await walletLpPositions(address) })
    return NextResponse.json(await walletHoldings(address))
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
