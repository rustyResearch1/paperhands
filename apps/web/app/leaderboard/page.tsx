import { db } from '@/lib/db'
import { getOrCreateUser } from '@/lib/session'
import HandleForm from '@/components/HandleForm'

const fmtEth = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 })

export const dynamic = 'force-dynamic'

interface BoardRow {
  id: string
  handle: string | null
  balance_quote: string
  mark_positions: number
  realized: number
  trades: number
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
    .all() as Omit<BoardRow, 'mark_positions'>[]

  const posStmt = db.prepare(
    `SELECT po.qty, tb.decimals,
       (SELECT close FROM candles c WHERE c.pool = po.pool ORDER BY minute_ts DESC LIMIT 1) AS close
     FROM positions po
     JOIN pools p ON p.address = po.pool
     JOIN tokens tb ON tb.address = CASE WHEN p.base_is_token0 = 1 THEN p.token0 ELSE p.token1 END
     WHERE po.user_id = ?`,
  )
  const rows = users
    .map((u) => {
      const positions = posStmt.all(u.id) as { qty: string; decimals: number; close: number | null }[]
      const mark_positions = positions.reduce(
        (acc, p) => acc + (Number(BigInt(p.qty)) / 10 ** p.decimals) * (p.close ?? 0),
        0,
      )
      return { ...u, mark_positions, equity: Number(BigInt(u.balance_quote)) / 1e18 + mark_positions }
    })
    .sort((a, b) => b.equity - a.equity)
    .slice(0, 50)

  return (
    <div>
      <h1 className="text-sm font-bold uppercase tracking-[0.14em] mb-1">the wall</h1>
      <p className="rule-label mb-4">
        ranked by equity (cash + positions at marked prices — the leaderboard flatters; your own ledger does not). start
        is 10 paper ETH.
      </p>

      <HandleForm current={me.handle} />

      {rows.length === 0 ? (
        <div className="slip p-8 max-w-md mx-auto my-12 text-center">
          <div className="stamp text-stamp mb-3">nobody yet</div>
          <p className="text-graphite">No one has placed a paper trade. The wall remembers the first.</p>
        </div>
      ) : (
        <table className="ledger w-full max-w-3xl">
          <thead>
            <tr>
              <th>#</th>
              <th>trader</th>
              <th>equity (ETH)</th>
              <th>realized pnl</th>
              <th>trades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isMe = r.id === me.id
              return (
                <tr key={r.id} className={isMe ? 'bg-marker/20' : ''}>
                  <td>{i + 1}</td>
                  <td className="font-bold">
                    {r.handle ?? `anon-${r.id.slice(0, 6)}`}
                    {isMe && <span className="rule-label ml-2">(you)</span>}
                  </td>
                  <td className={r.equity >= 10 ? 'text-up font-bold' : 'text-down font-bold'}>{fmtEth(r.equity)}</td>
                  <td className={r.realized >= 0 ? 'text-up' : 'text-down'}>
                    {r.realized >= 0 ? '+' : ''}
                    {fmtEth(r.realized)}
                  </td>
                  <td className="text-graphite">{r.trades}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
