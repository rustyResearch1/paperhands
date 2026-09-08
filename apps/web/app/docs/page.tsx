import { counters } from '@/lib/counters'

export const metadata = { title: 'PaperHands API' }
export const dynamic = 'force-dynamic'

const ENDPOINTS = [
  {
    path: '/api/v1/quote',
    params: 'token, side=buy|sell, amount (raw units: ETH wei for buys, token units for sells), real=1 (only routes one wallet transaction can sign: hookless v3 via SwapRouter02, or all-v4 via the Universal Router)',
    what: 'Best-fill route across every venue a token has — v3 tiers, v4 pools (hooked ones through the on-chain quoter), 2-leg via USDG. Exact engine math (validated wei-for-wei against the on-chain quoters). Returns amounts, impact, price move, instant-exit, markInflation and per-leg execution details including v4 pool keys.',
    example: '/api/v1/quote?token=0xd7321801caae694090694ff55a9323139f043b88&side=buy&amount=1000000000000000000',
  },
  {
    path: '/api/v1/depth',
    params: 'token, side=buy|sell',
    what: 'The impact curve: output, impact and price move at standard sizes (0.01–25 ETH). Depth as it should have always been defined.',
    example: '/api/v1/depth?token=0xd7321801caae694090694ff55a9323139f043b88',
  },
  {
    path: '/api/v1/pools',
    params: 'sort=traction|vol|change5m|change30m|trades|depth, limit, safe=0|1',
    what: 'One row per token with price, traction (30m volume acceleration), volumes, trades, depth, verification.',
    example: '/api/v1/pools?sort=traction&limit=20',
  },
  {
    path: '/api/v1/replay',
    params: 'wallet, eth (size per mirrored buy), hours',
    what: 'Would tailing this wallet have worked at your size? Replays its recorded trades through historical liquidity with your bankroll. Leftovers exit at realizable value.',
    example: '/api/v1/replay?wallet=0xf70da97812cb96acdf810712aa562db8dfa3dbef&eth=0.25&hours=24',
  },
  {
    path: '/api/v1/lp',
    params: 'pool (v3 hookless), range (± %), eth (deposit), hours',
    what: 'LP backtest: your position is added to the pool and every recorded swap re-executes through it. Fees earned, impermanent loss, net vs holding, APR run-rate.',
    example: '/api/v1/lp?pool=0x588b0785f50063260003b7790c42f1ef74902746&range=30&eth=1&hours=24',
  },
  {
    path: '/api/v1/xquote',
    params: 'chain=rh|sol|bsc, token (address or mint), side=buy|sell, amount (raw: wei/lamports for buys, token units for sells)',
    what: 'One honest quote shape on every chain: fill, impact, route and who quoted it (our exact engine on Robinhood Chain and PancakeSwap v3; Jupiter on Solana; KyberSwap when it fills better on BNB Chain), sold-right-back, gas, and whether one wallet transaction can sign it — plus the runner-up fill.',
    example: '/api/v1/xquote?chain=sol&token=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263&side=buy&amount=100000000',
  },
  {
    path: '/api/v1/xtx',
    params: 'POST { quote, user, slippageBps } — the quote from xquote (≤60s old), the signer address or pubkey',
    what: 'The transaction that wallet signs: a base64 VersionedTransaction on Solana (Jupiter), {to, data, value} on BNB Chain (PancakeSwap SmartRouter calldata from our route, or KyberSwap’s). Never signed or sent here.',
    example: '/docs',
  },
  {
    path: '/api/v1/xvalue',
    params: 'POST { chain, holdings: [{ token, amount }] } — up to 15 bags',
    what: 'What the venue would pay for each bag right now: a full-size sell quote per token (engine on Robinhood Chain / PancakeSwap, Jupiter on Solana, KyberSwap when better). The number a portfolio should show instead of the chart price.',
    example: '/docs',
  },
  {
    path: '/api/v1/lp/pools',
    params: 'chains=rh,sol,bsc, limit',
    what: 'The LP screener: Robinhood Chain, Orca + Meteora (Solana) and PancakeSwap v3 (BNB Chain) pools with 24h fee yield, volume/TVL, realized σ and the fee-to-vol score, plus 1σ / 2σ / 4σ ranges.',
    example: '/api/v1/lp/pools?chains=sol,bsc&limit=20',
  },
  {
    path: '/api/v1/xprice',
    params: '—',
    what: 'USD prices of ETH (Robinhood Chain), SOL and BNB, from the same sources the quotes use.',
    example: '/api/v1/xprice',
  },
  {
    path: '/api/v1/xcandles',
    params: 'chain=sol|bsc, pool, tf=minute|hour|day, agg, limit',
    what: 'USD candles for any pool on Solana or BNB Chain (GeckoTerminal).',
    example: '/api/v1/xcandles?chain=sol&pool=5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9&limit=20',
  },
  {
    path: '/api/health',
    params: '—',
    what: 'Liveness and freshness: the indexer cursor (last ingested block), pool count, and the age of the Wire ranking. Poll it before trusting anything time-sensitive.',
    example: '/api/health',
  },
  {
    path: '/api/v1/alerts',
    params: 'limit (≤100)',
    what: 'What changed a position’s truth in the last few hours: liquidity pulled (≥50% of active depth in one transaction), dumps (−50% in 3h with real volume) and volume surges (≥4× the previous half hour). Straight from the ledger, no opinions.',
    example: '/api/v1/alerts?limit=20',
  },
]

export default function Docs() {
  let served: Record<string, number> = {}
  try {
    served = counters('api.v1.')
  } catch {
    // counters are decoration
  }
  const total = Object.values(served).reduce((a, b) => a + b, 0)
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rise">
        <h1 className="text-[28px] font-semibold tracking-tight">API</h1>
        <p className="text-muted">
          The same engine that powers every screen, as JSON. Free, no key, 60 requests per minute per IP (30 for depth). Built for
          agents and bots that need honest execution numbers, not chart prices.
        </p>
        {total > 0 && (
          <p className="mt-2 flex flex-wrap gap-1.5 text-[12px] text-faint">
            <span className="pill">{total.toLocaleString()} requests served</span>
            {Object.entries(served).map(([k, n]) => (
              <span key={k} className="chip">
                {k.replace('api.v1.', '')} {n.toLocaleString()}
              </span>
            ))}
          </p>
        )}
      </div>
      {ENDPOINTS.map((e) => (
        <div key={e.path} className="card rise rise-2 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill pill-up">GET</span>
            <code className="num text-[15px] font-semibold">{e.path}</code>
          </div>
          <p className="mt-2 text-[14px]">{e.what}</p>
          <p className="mt-2 text-[13px] text-muted">
            <span className="label">params</span> {e.params}
          </p>
          <a className="num mt-3 block overflow-x-auto rounded-xl bg-bg-3 px-3 py-2 text-[12.5px] text-pen" href={e.example} target="_blank" rel="noreferrer">
            {e.example}
          </a>
        </div>
      ))}
      <p className="text-[12px] text-faint">
        Quotes are non-binding simulations of live pool state. Practice balances are not money. Nothing here is financial advice.
      </p>
    </div>
  )
}
