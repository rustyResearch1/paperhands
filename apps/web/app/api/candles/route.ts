import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const pool = req.nextUrl.searchParams.get('pool')?.toLowerCase()
  const from = Number(req.nextUrl.searchParams.get('from') ?? 0)
  if (!pool) return NextResponse.json({ error: 'pool is required' }, { status: 400 })
  const rows = db
    .prepare(
      `SELECT minute_ts AS time, open, high, low, close, vol_quote AS volume
       FROM candles WHERE pool = ? AND minute_ts > ? ORDER BY minute_ts ASC LIMIT 3000`,
    )
    .all(pool, from)
  return NextResponse.json(rows)
}
