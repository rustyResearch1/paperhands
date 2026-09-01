# PaperHands — launch & traction plan

## Positioning (one sentence, use it everywhere)

> The execution-honest paper trading terminal for Robinhood Chain: practice on live
> liquidity, see what your bags are *actually* worth, and replay any whale before you
> copy them.

## Sequence

1. **GitHub public** — the repo *is* marketing: a wei-for-wei validated Uniswap engine,
   receipts in the README, MIT license. Devs star what they wish they'd built.
2. **Deploy** — Railway one-box (Dockerfile in repo root, volume at `/data`, env
   `PAPERHANDS_RPC` set to an Alchemy Robinhood Chain endpoint). Custom domain when ready.
3. **X account** — handle ideas: `@paperhandsxyz`, `@paperhands_rh`, `@thepaperhands`.
   Bio: "prove you're not. execution-honest paper trading on Robinhood Chain.
   not real money, real everything else."
4. **Launch thread** (draft below), then reply-guy the ecosystem: Pons, hood.fun,
   HOOD10, Delta, Blockworks-style commentators, Vlad-adjacent meme accounts.

## The content engine (this is the actual growth plan)

Every feature generates screenshots nobody else can make. Recurring formats:

- **The Replay Files** (weekly): "Wallet 0xf70d… made +2.7 ETH this week. We replayed
  copying it at 0.25 ETH/buy: **−26%.** Whales profit. Copiers are exit liquidity."
  → screenshot of the replay panel. Tag nobody; let them find themselves.
- **Rug Receipts** (event-driven): screener catches −90% + drained depth in real time
  (CASHBIRD, QSB on day one; a counterfeit USDG pool auto-stamped UNVERIFIED).
- **Mark vs Reality** (weekly): biggest markInflation on the chain — "this token's
  holders think they have $X. The pool would pay $Y."
- **LP Lab results** (weekly): "LPing JUGGERNAUT ±30% last 24h: +61bps in fees, ~0 IL,
  ~3,500% APR run-rate. LPing <trending token>: fees didn't cover the bleed."
- **The honesty audit series** (launch ammo): run HOOD10's dividend basket through the
  engine — marked vs realizable value of what they actually distribute.
- **Season finales** (once Seasons ship): winner's ledger card, wall of shame.

Cadence: 1 data post/day, replies > posts, screenshots > text. Everything links the site.

## Launch thread draft

1/ everyone thinks they can pick memecoins. we built the place to prove it — with the
one thing every paper-trading app lies about: **your fills.**

2/ PaperHands simulates every trade through Robinhood Chain's actual Uniswap liquidity,
tick by tick. our engine matches the chain's own quoter **wei-for-wei** (receipts in
the repo). 10 fantasy ETH. real everything else.

3/ your position isn't worth price × bags. it's worth what the pool would pay you to
leave. we show both. the gap is why people diamond-hand to zero.

4/ the Wire ranks real wallets by ETH actually pulled OUT of pools — not marked bags.
found a wallet up +2.7 ETH this week. looks copyable, right?

5/ so we replayed copying it — every entry, every exit, at retail size, through
recorded history. result: **−26%.** whales profit. copiers are exit liquidity.
now you can run that test on any wallet before you tail it.

6/ also in the lab: would LPing have beaten holding? we replay every recorded swap
through your virtual position. sometimes the answer is 3,500% APR. sometimes the fees
don't cover the bleed. we tell you which.

7/ free. open source. not real money, and not financial advice — that's the point.
come find out if you have it. [link]

## Metrics that matter (first month)

- unique paper accounts, trades/day, replay+LP lab runs (add a counters table)
- GitHub stars, X followers as vanity proxies
- ONE number to optimize: **replay runs** — it's the shareable, differentiated act

## Later plays

- $PAPER Seasons pot on Pons (fees → tokenized-stock prizes for the leaderboard) —
  needs legal sanity check on promotions law first
- Postgres migration → web on Vercel, indexer stays Railway
- Public API for agents (the chain's "agentic trading" narrative wants our quotes)
