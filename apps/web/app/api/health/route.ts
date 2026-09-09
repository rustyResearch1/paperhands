import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — cheap liveness + freshness for the platform healthcheck
 * and for anyone wondering whether the ledger is current. DB reads only.
 */
export async function GET() {
  try {
    const meta = (key: string) => (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined)?.value ?? null
    const cursor = Number(meta('watch_cursor') ?? 0)
    const wireTs = Number(meta('wire_rank_ts') ?? 0)
    const screenerTs = Number(meta('screener_ts') ?? 0)
    const pools = (db.prepare(`SELECT COUNT(*) AS n FROM pools`).get() as { n: number }).n
    const now = Math.floor(Date.now() / 1000)
    return NextResponse.json(
      {
        ok: cursor > 0,
        cursor,
        pools,
        wireRankAgeSec: wireTs ? now - wireTs : null,
        screenerAgeSec: screenerTs ? now - screenerTs : null,
        dedicatedRpc: Boolean(process.env.PAPERHANDS_RPC && process.env.PAPERHANDS_RPC !== 'https://rpc.mainnet.chain.robinhood.com'),
        deployment: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
        at: now,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 })
  }
}
