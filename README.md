# 🧻 PaperHands

**Honest trading on Robinhood Chain — practice with a paper bankroll, or trade for real
from your own wallet. Same exact engine either way.**

Everyone thinks they can pick memecoins. PaperHands lets you find out with 10 fantasy ETH
instead of your rent — and unlike every other paper-trading toy, it refuses to lie to you
about your fills. When you're ready, flip the switch to **Real**: the same quotes become
transactions your wallet signs, straight to the Uniswap contracts. We never hold keys or
funds.

Production: one Railway box against **Robinhood Chain mainnet** (chain id 4663).

---

## The thesis: mark-to-market is the lie

Paper trading apps fill you at the chart price. For memecoins that isn't a simplification,
it's the *opposite of the lesson*. On thin concentrated liquidity:

- a real buy moves the price against you before it finishes filling;
- a "+540%" position can be worth −0.4% of what you paid the moment you try to exit;
- the chart marks your bag at the last trade's price — through liquidity that cannot
  possibly absorb your size.

So PaperHands simulates every fill through **the actual Uniswap tick-walk math against
live pool state**, and scores every position by what the pool *would actually pay you to
leave*, not what the chart says. Two numbers, everywhere — in practice *and* on your real
wallet's holdings:

> ~~marked value 0.4928 ETH~~ · <mark>**pool would pay 0.4879 ETH**</mark>

The gap between those numbers is why people diamond-hand to zero.

## Receipts

The fill engine is a zero-dependency bigint port of Uniswap v3's FullMath / TickMath /
SqrtPriceMath / SwapMath plus the pool swap loop, extended with v4's per-direction
protocol fee. It is validated **wei-for-wei against the chain's own quoters** on live pools:

```
v3 · pool 0x588b0785…02746 (fee 1%)  WETH/JUGGERNAUT  ticks known=145
   0.01 ETH → local=2845846999690535243705 chain=2845846999690535243705 ✓ sqrtPrice ✓
      1 ETH → local=283433542895548274261200 chain=283433542895548274261200 ✓ sqrtPrice ✓
     10 ETH → local=2732276397268303020327805 chain=2732276397268303020327805 ✓ sqrtPrice ✓
4 exact matches, 0 mismatches — including a 4-tick-crossing 10 ETH swap at ~400bps impact

v4 · 12 sizes across 3 pools vs the on-chain v4 Quoter: 11 exact, 1 within 2.4e-21 (dust)
```

Run it yourself: `pnpm --filter @paperhands/chain validate` (v3) · `validate:v4`.

The real-execution path is proven the same way — `apps/web/scripts/sim-real-swap.mts`
takes a live quote, builds the exact calldata a wallet would sign, and `eth_call`s +
`eth_estimateGas` it against chain state (Universal Router v4 swaps: ~155–166k gas,
hooked pools included).

## What's in the box

```
packages/engine    the fill simulator — exact v3/v4 swap math, honesty metrics
                   (realizable value, round-trip retention, markInflation). Pure bigint.
packages/chain     Robinhood Chain client: verified Uniswap deployment addresses (v3, v4,
                   Universal Router, Permit2), pool state readers, quoter validation scripts.
packages/indexer   activity-based discovery (chain-wide Swap logs under the RPC's 10k-log
                   cap), factory verification, 1-minute candles, trader attribution,
                   liquidity events, event-sourced replay, backups. SQLite.
apps/web           the terminal (Next.js 15): screener, charts, impact curves, the order
                   sheet (practice + real), portfolio (paper + wallet), LP Lab, Wire, alerts,
                   hook classifier, public API.
```

## Practice or Real — one switch, one engine

**Practice** gives you 10 ETH of paper bankroll. Every order routes like an aggregator
would — across every venue the token has (v3 fee tiers, v4 pools, 2-leg paths through
USDG) — and fills on the best. Positions are marked at what the pool would pay.

**Real** connects your own wallet (injected — Rabby, MetaMask, Robinhood's wallet) and
turns the same quote into one signed transaction, non-custodially:

| Route | Signs through | Notes |
|---|---|---|
| hookless v3 (1 or 2 legs) | `SwapRouter02` · `exactInputSingle` / `exactInput` + `unwrapWETH9` | ETH in / ETH out; sells need one ERC20 approval |
| v4 (1 or 2 legs, hooked or not) | `UniversalRouter.execute` · `V4_SWAP` = chained `SWAP_EXACT_IN_SINGLE` (later hops spend the open delta) + `SETTLE_ALL` + `TAKE_ALL` | native ETH in as `msg.value`; sells pull via Permit2 (ERC20→Permit2, then a 30-day Permit2 grant to the router) |

A deployment detail worth knowing: this chain's Universal Router was built from a
v4-periphery revision whose `ExactInputSingleParams` still carries `sqrtPriceLimitX96`.
Encode the final-release five-field struct and every non-native pool reverts with empty
data (the router reads a bogus hookData offset). We found it by decoding live router
transactions; `sim-real-swap.mts` guards against regressions.

`amountOutMinimum` is our exact quote less 1%. Routing in real mode only considers
routes one transaction can sign, and keeps 2-leg routes inside one protocol version.
Hooked pools are quoted by the chain's own v4 Quoter (so whatever the hook takes is in the
number) — and the hook can still refuse the real swap, which your wallet's simulation shows.

**LP for real** — the LP Lab's suggested range becomes a v3 `NonfungiblePositionManager`
mint (ETH side sent native, refund in the same multicall). From the portfolio: **Collect**
(collect → unwrap WETH → sweep token) and **Close** (decrease → collect → burn), each one
signature. Out-of-range positions are flagged.

Everything real-money is non-custodial by construction: we build calldata, your wallet
signs, the Uniswap contracts settle to you.

## Three chains, one honesty

The same terminal now covers **Solana** and **BNB Chain** next to Robinhood Chain, with
the same rules everywhere — best route, exact numbers where we can compute them, and a
real "sold right back" quote so a bag is never worth more than the venue would pay:

| Chain | Quotes | Real execution | LP |
|---|---|---|---|
| Robinhood Chain | our exact engine, every v3/v4 venue | SwapRouter02 / Universal Router | v3 NFPM mint · collect · close, backtests |
| Solana | Jupiter across every Solana DEX + reverse quote | Jupiter transaction signed in Phantom | Orca Whirlpools: σ-ranged open / close built for your pubkey, signed in Phantom; screener also covers Meteora DLMM |
| BNB Chain | PancakeSwap v3 through our engine (it's a Uniswap v3 fork) **vs** KyberSwap — best fill wins, runner-up shown | PancakeSwap SmartRouter or KyberSwap calldata, signed by your wallet | PancakeSwap v3: σ-ranged mint · collect · close through Pancake's position manager |

- `/x` — **best execution across chains**: the same $100–$10k into USDC, USDT, ETH, BTC or SOL on
  every chain: value received, cost in bps, impact, gas, and who quoted it.
- `/lp` — **the LP screener**: every pool ranked by *fee-to-vol* (24h fees ÷ TVL, divided by
  realized daily σ), with 1σ / 2σ / 4σ ranges. High yield on a calm pair beats a screaming APR
  on something that moves 80% a day.
- Paper ledgers on Solana (10 SOL) and BNB Chain (5 BNB), filled at the same live quotes.
- Portfolio → Real shows Phantom and BNB Chain holdings valued by full-size sell quotes.

All keyless public data (Jupiter, KyberSwap, GeckoTerminal, Orca, Meteora); all execution
non-custodial.

## Every venue, best fill

Robinhood Chain is fragmented: a token can trade on several v3 fee tiers and v4 pools
(native ETH or USDG quoted, half of them with launchpad hooks) at once. Every order is
routed across all of them; hookless pools are quoted by our engine, hooked v4 pools by the
chain's v4 Quoter. The order sheet shows the route it took.

## Deep tech

- **Impact curve** (every token page, `/api/v1/depth`): output, impact and price move at
  0.01–25 ETH — depth as it should always have been defined. "A 25 ETH buy costs 17.7% of
  impact and moves the price +44.6%."
- **Hook classifier** (hooked pool pages): a v4 hook's permissions are literally its
  address bits. We decode them into capabilities and a risk tier — *takes a cut of swaps*,
  *can block LP withdrawals*, *sets its own fee per swap* — plus adoption (pools, swaps).
- **LP strategy engine**: realized 1-minute volatility → 24h σ → tight/balanced/wide
  ranges, backtested on demand through the pool's recorded swaps (parallel-universe honest:
  your position is added to the pool and pays its own impact).
- **Alerts** (Wire, `/api/v1/alerts`): liquidity pulled (≥50% of active depth in one tx),
  dumps (−50% in 3h with real volume), volume surges (≥4× the previous half hour). Straight
  from the ledger.
- **Event-sourced replay**: any pool's full state at any past block (live snapshot,
  reverse-patched by Mint/Burn or ModifyLiquidity deltas), self-validated by re-executing
  recorded swaps: `USDG/WETH 1,996 swaps — amountOut exact 98.4%`.

## Public API (v1)

`/api/v1/quote` · `/api/v1/depth` · `/api/v1/pools` · `/api/v1/replay` · `/api/v1/lp` ·
`/api/v1/alerts` — free, no key, 60 req/min per IP. `/docs` has examples. `real=1` on
quote returns only wallet-signable routes with per-leg execution details (v4 pool keys
included), so bots can build the same calldata we do.

## Run it

```bash
pnpm install

# 1. sweep the chain and start recording (keep this running)
pnpm --filter @paperhands/indexer dev

# 2. the terminal
pnpm --filter @paperhands/web dev     # → http://localhost:3000

# tests & proofs
pnpm test                                   # engine unit tests
pnpm --filter @paperhands/chain validate    # engine vs on-chain QuoterV2
pnpm --filter @paperhands/chain validate:v4 # engine vs on-chain v4 Quoter
pnpm --filter @paperhands/web sim [pool] [buy|sell] [amountRaw]   # real calldata vs chain (needs the web app running)
```

Env: `PAPERHANDS_DB` (SQLite path), `PAPERHANDS_RPC` (use a dedicated Alchemy/QuickNode
endpoint in production — the public RPC rate-limits and serves only ~3k blocks of pinned
state), `PAPERHANDS_SECRET` (cookie HMAC), `NEXT_PUBLIC_SITE_URL`.

## Deploy

One box runs everything (the indexer must run continuously — replay history depends on
unbroken event coverage). The repo ships a `Dockerfile` + `railway.json`:

```bash
railway up          # from the repo root; add a volume mounted at /data
```

## Coverage

- **Uniswap v3** (TickLens state) and **Uniswap v4** (StateView + singleton PoolManager
  stream — v4 is the chain's busiest venue). v4 amounts are normalized to v3's sign
  convention at ingest.
- Quotes in **WETH, native ETH, and USDG**. The paper ledger stays ETH-denominated; USDG
  pools trade through 2-leg routing.
- Hooked pools trade (quoted on-chain); LP backtests and LP minting cover hookless v3
  ETH pools today. v4 LP (PositionManager) is next.

## Durability

- Identities are HMAC-signed cookies; every account has a portable **account key** that
  survives cleared cookies and devices.
- SQLite online backups every 6h — local rotation plus optional Cloudflare R2.
- Rolling retention (default 7 days of swaps/liquidity); candles are kept forever. A long
  indexer outage self-heals: the cursor jumps, the replay floor moves with it.

## The Wire — wallet intelligence and tailing

`/wire` ranks real attributed wallets by **ETH actually taken out of pools** (not marked
bags). Every wallet gets a page (`/w/0x…`) with per-pool flows, and any wallet can be
**tailed** into your paper account through the same honest engine — you eat *your*
slippage at *your* size. The **Replay Lab** answers "would tailing this wallet have worked
at my size?" before you do.

## Roadmap

- v4 LP (mint / collect / close through the v4 PositionManager), including hookless
  launchpad graduates.
- Validation badges on pool pages from a scheduled replay-validate.
- Seasons — 10 ETH, four weeks, wall of fame/shame.

## Disclaimers

Practice balances are fantasy and not money. Real mode signs transactions from your own
wallet to public Uniswap contracts; you are responsible for them. Not affiliated with
Robinhood or Uniswap. Nothing here is financial advice.
