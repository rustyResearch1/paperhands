import HandleForm from '@/components/HandleForm'
import { db } from '@/lib/db'
import { getOrCreateUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Leaderboard' }

const fmtEth = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 })

interface BoardRow {
  id: string
  handle: string | null
  balance_quote: string
  mark_positions: number
  realized: number
  trades: number
  equity: number
}

export default async function Leaderboard() {
  const me = await getOrCreateUser()
  const users = db
    .prepare(
      `SELECT u.id, u.handle, u.balance_quote,
        COALESCE((SELECT SUM(CAST(realized_quote AS REAL)) / 1e18 FROM positions WHERE user_id = u.id), 0) AS realized,
        (SELECT COUNT(*) FROM paper_trades WHERE user_id = u.id) AS trades
      FROM users u
      WHERE (SELECT COUNT(*) FROM paper_trades WHERE user_id = u.id) > 0`,
    )
    .all() as Omit<BoardRow, 'mark_positions' | 'equity'>[]

  const posStmt = db.prepare(
    `SELECT po.qty, tb.decimals,
       (SELECT close FROM candles c WHERE c.pool = po.pool ORDER BY minute_ts DESC LIMIT 1) AS close
     FROM positions po
     JOIN pools p ON p.address = po.pool
     JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
     WHERE po.user_id = ?`,
  )
  const rows: BoardRow[] = users
    .map((u) => {
      const positions = posStmt.all(u.id) as { qty: string; decimals: number; close: number | null }[]
      const mark_positions = positions.reduce((acc, p) => acc + (Number(BigInt(p.qty)) / 10 ** p.decimals) * (p.close ?? 0), 0)
      return { ...u, mark_positions, equity: Number(BigInt(u.balance_quote)) / 1e18 + mark_positions }
    })
    .sort((a, b) => b.equity - a.equity)
    .slice(0, 50)

  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-muted">Practice equity from a 10 ETH start. Ranked at marked prices — your own portfolio shows the honest number.</p>
        </div>
        <HandleForm current={me.handle} />
      </div>

      {rows.length === 0 ? (
        <div className="card mx-auto my-12 max-w-md p-8 text-center">
          <div className="pill mb-3">nobody yet</div>
          <p className="text-muted">No one has placed a paper trade. The board remembers the first.</p>
        </div>
      ) : (
        <div className="card rise rise-2 max-w-3xl overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Trader</th>
                <th>Equity</th>
                <th>Realized</th>
                <th className="hidden md:table-cell">Trades</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isMe = r.id === me.id
                return (
                  <tr key={r.id} className={isMe ? 'bg-up-soft/40' : ''}>
                    <td className="text-muted">{i + 1}</td>
                    <td className="font-semibold">
                      {r.handle ?? `anon-${r.id.slice(0, 6)}`}
                      {isMe && <span className="pill pill-up ml-2">you</span>}
                    </td>
                    <td className={r.equity >= 10 ? 'text-up font-semibold' : 'text-down font-semibold'}>{fmtEth(r.equity)} ETH</td>
                    <td className={r.realized >= 0 ? 'text-up' : 'text-down'}>
                      {r.realized >= 0 ? '+' : ''}
                      {fmtEth(r.realized)}
                    </td>
                    <td className="hidden text-muted md:table-cell">{r.trades}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
