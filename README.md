# 🧻 PaperHands

**Execution-honest paper trading for Robinhood Chain memecoins.**

Everyone thinks they can pick memecoins. PaperHands lets you find out with 10 fantasy ETH
instead of your rent — and unlike every other paper-trading toy, it refuses to lie to you
about your fills.

Live at `localhost:3000` against **Robinhood Chain mainnet** (chain id 4663).

---

## The thesis: mark-to-market is the lie

Paper trading apps fill you at the chart price. For memecoins that isn't a simplification,
it's the *opposite of the lesson*. On thin concentrated liquidity:

- a real buy moves the price against you before it finishes filling;
- a "+540%" position can be worth −0.4% of what you paid the moment you try to exit;
- the chart marks your bag at the last trade's price — through liquidity that cannot
  possibly absorb your size.

So PaperHands simulates every fill through **the actual Uniswap v3 tick-walk math against
live pool state**, and scores every position by what the pool *would actually pay you to
leave*, not what the chart says. Two numbers, everywhere:

> ~~marked value 0.4928 ETH~~ · <mark>**pool would pay 0.4879 ETH**</mark>

The gap between those numbers is why people diamond-hand to zero.

## Receipts

The fill engine is a zero-dependency bigint port of Uniswap v3's FullMath / TickMath /
SqrtPriceMath / SwapMath plus the pool swap loop. It is validated **wei-for-wei against the
chain's own QuoterV2** on live pools:

```
pool 0x588b0785…02746 (fee 1%)  WETH/JUGGERNAUT  ticks known=145
   0.01 ETH → local=2845846999690535243705 chain=2845846999690535243705 ✓ sqrtPrice ✓
    0.1 ETH → local=28447966307267948715881 chain=28447966307267948715881 ✓ sqrtPrice ✓
      1 ETH → local=283433542895548274261200 chain=283433542895548274261200 ✓ sqrtPrice ✓
     10 ETH → local=2732276397268303020327805 chain=2732276397268303020327805 ✓ sqrtPrice ✓
4 exact matches, 0 mismatches — including a 4-tick-crossing 10 ETH swap at ~400bps impact
```

Run it yourself: `pnpm --filter @paperhands/chain validate`

A finding from building this, verified independently by hand: an *instant* round trip in a
single pool costs almost exactly 2×fee at any size — price impact cancels on reversal, plus
a small convexity rebate. The danger was never the round trip. It's that a pool-moving buy
**marks the bag at the pumped price** (`markInflation` in the engine: mark ÷ realizable,
which hits 6× in tests) while everyone else's exit lands before yours.

## What's in the box

```
packages/engine    the fill simulator — exact v2/v3 swap math, honesty metrics
                   (realizable value, round-trip retention, markInflation).
                   Pure bigint, zero dependencies, 33 unit tests.
packages/chain     Robinhood Chain client: verified Uniswap deployment addresses,
                   v3 pool state reader (slot0 + TickLens window), live QuoterV2
                   cross-validation script.
packages/indexer   activity-based discovery (chain-wide Swap logs, adaptive range
                   bisection under the RPC's 10k-log cap), factory verification of
                   every pool, 1-minute candles, trader attribution, SQLite.
apps/web           the paper-ledger terminal (Next.js): screener, live charts, the
                   order slip, portfolio, leaderboard.
```

First discovery sweep found **1,138 pools / 901 tokens** in ~30 minutes of chain history,
including two rugs in progress (−90%+ in 30m with drained depth) and a **counterfeit USDG
pool** — which the factory-verification layer flagged automatically. Unverified pools show
an `UNVERIFIED` stamp and cannot be traded.

## Run it

```bash
pnpm install

# 1. sweep the chain and start recording (keep this running)
pnpm --filter @paperhands/indexer dev

# 2. the terminal
pnpm --filter @paperhands/web dev     # → http://localhost:3000

# tests & proofs
pnpm test                             # engine unit tests
pnpm --filter @paperhands/chain validate   # engine vs on-chain QuoterV2
```

No wallet, no keys, no funds. The only network dependency is the public RPC
(`rpc.mainnet.chain.robinhood.com`). Env overrides: `PAPERHANDS_DB` (SQLite path) and
`PAPERHANDS_RPC` (use a dedicated Alchemy/QuickNode endpoint in production — the public
RPC rate-limits).

## Deploy

One box runs everything (the indexer must run continuously — replay history depends on
unbroken event coverage). The repo ships a `Dockerfile` + `railway.json`:

```bash
railway up          # from the repo root; add a volume mounted at /data
```

Set `PAPERHANDS_RPC` to a dedicated endpoint. The web terminal serves on `$PORT`, the
indexer discovers, watches, attributes, and mirrors tails in the same container, and
the ledger lives on the volume. (Vercel + Postgres split is the scale-up path — the
SQLite one-box is deliberate for v0.)

## How a fill actually works here

1. Ticket asks `/api/quote` → server reads **live** `slot0`, in-range liquidity, and a
   ±8-word TickLens window from the pool (10s cache).
2. The engine walks the swap tick-by-tick — `computeSwapStep`, liquidity-net crossings,
   fee accounting — identically to `UniswapV3Pool.swap`.
3. You see: spot, your fill, price impact (fee separated), what you'd get **selling it
   right back**, and how much a PnL screen would overstate your bag.
4. Orders the pool couldn't absorb are rejected, not pretend-filled. Positions are scored
   by simulated full exit every time you look at them.

What it deliberately does not model (yet): your trade moving the market for *others*,
MEV/sandwiches, and gas (~negligible on the L2 for sizes that matter here).

## The Wire — wallet intelligence and tailing

`/wire` ranks real attributed wallets by **ETH actually taken out of pools** (not marked
bags), over the tracked window. Every wallet gets a page (`/w/0x…`) with per-pool flows —
what they bought, what they banked, what they're still holding. And any wallet can be
**tailed**: set a size, and the indexer mirrors their swaps into your paper account through
the same honest engine — their buy triggers your fixed-size buy, their sell exits your
tailed position. You eat *your* slippage at *your* size, which is exactly the lesson:
copying a whale's entries is not copying their exits.

## The Lab — time travel, proven against the chain

The indexer stores every Swap and every Mint/Burn, so any pool's **full state at any
past block** can be reconstructed (live snapshot, reverse-patched by liquidity deltas,
anchored on recorded in-range liquidity). Replays then re-execute recorded swap inputs
through the engine — which makes the whole thing self-validating: simulated outputs must
reproduce what actually happened on-chain. Measured on live pools:

```
USDG/WETH   1,996 swaps,  6 liq events — amountOut exact 98.4%
JUGGERNAUT    239 swaps, 52 liq events — amountOut exact 99.2%
(residual mismatches are wei-level rounding on trades that executed exact-output)
```

Two counterfactual instruments ship on top, both **parallel-universe honest** (your
virtual position or orders are added to the pool, so you pay your own impact and earn
only your own share):

- **LP Lab** (token pages) — would providing liquidity have paid? Pick a range and
  deposit; every recorded swap re-executes through your position; you get fees earned,
  impermanent loss, net-vs-hodl and the run-rate. First live run: 1 ETH ±30% on
  JUGGERNAUT earned 61bps in 1.5h of sideways chop (~3,500% APR) — and the same tool
  will happily tell you when fees did NOT cover the bleed.
- **Replay Lab** (wallet pages) — would tailing this wallet have worked *at your size*?
  Mirrors its recorded entries/exits through history; leftovers exit realizable. First
  live run: a whale up +2.7 ETH real — copying it at 0.25 ETH/buy lost money.

Commands: `main.ts liq-backfill` (resumable) · `main.ts replay-validate [pool]`.
The watch loop must run continuously — reconstruction needs unbroken event coverage,
and the replay floor advances if it gaps.

## Roadmap

- **Tail replay** — run a wallet's past month through your bankroll size before tailing it.
- **Replay mode** — enter at any historical candle, exit through reconstructed liquidity.
- **Seasons** — 10 ETH, four weeks, wall of fame/shame.
- USDG-quoted pools (needs a quote-currency dimension on the ledger first), v2 pairs,
  v4 hooks as liquidity migrates.

## Disclaimers

Simulated trading with fantasy balances. Not affiliated with Robinhood. Nothing here is
financial advice, and none of it is money.
