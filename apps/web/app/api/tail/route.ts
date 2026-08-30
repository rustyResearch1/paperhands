import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getOrCreateUser } from '@/lib/session'

const MAX_TAILS = 10
const MAX_SIZE_ETH = 2

export async function POST(req: NextRequest) {
  const user = await getOrCreateUser()
  if (user.id === '__ephemeral') return NextResponse.json({ ok: false, error: 'No session. Reload the page.' }, { status: 401 })

  let body: { wallet?: string; size?: string; stop?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }
  const wallet = body.wallet?.toLowerCase()
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) {
    return NextResponse.json({ ok: false, error: 'invalid wallet' }, { status: 400 })
  }

  if (body.stop) {
    db.prepare('UPDATE kol_tails SET active = 0 WHERE user_id = ? AND wallet = ?').run(user.id, wallet)
    return NextResponse.json({ ok: true })
  }

  const size = Number.parseFloat(body.size ?? '')
  if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE_ETH) {
    return NextResponse.json({ ok: false, error: `size must be between 0 and ${MAX_SIZE_ETH} ETH` }, { status: 422 })
  }
  const active = db
    .prepare('SELECT COUNT(*) AS n FROM kol_tails WHERE user_id = ? AND active = 1')
    .get(user.id) as { n: number }
  if (active.n >= MAX_TAILS) {
    return NextResponse.json({ ok: false, error: `at most ${MAX_TAILS} active tails` }, { status: 422 })
  }

  const sizeWei = BigInt(Math.round(size * 1e6)) * 10n ** 12n
  const lastBlock =
    (db.prepare('SELECT MAX(block) AS b FROM swaps').get() as { b: number | null }).b ?? 0
  db.prepare(
    `INSERT INTO kol_tails(user_id, wallet, size_quote, active, created_ts, last_block)
     VALUES(?,?,?,1,?,?)
     ON CONFLICT(user_id, wallet) DO UPDATE SET size_quote = excluded.size_quote, active = 1, last_block = excluded.last_block`,
  ).run(user.id, wallet, sizeWei.toString(), Math.floor(Date.now() / 1000), lastBlock)

  return NextResponse.json({ ok: true })
}
