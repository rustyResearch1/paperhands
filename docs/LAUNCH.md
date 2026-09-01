# PaperHands — launch playbook

## What the research says (and how it maps to us)

**DeFiLlama** became the industry's default data source by launching as the *honesty
correction* to inflated TVL claims — open source, no token, no VC, anonymous-friendly.
Credibility through independence WAS the growth strategy; the product's neutrality made
everyone cite it. → We are the same shape: the honesty correction to marked PnL and
copy-trading fantasy. Ship open source, no token at launch, let the receipts (wei-for-wei
QuoterV2 validation, replay verdicts) do the talking.

**pump.fun** won on radical friction removal (no code, no presale, connect-and-go) and by
riding its chain's boom at exactly the right moment. → We're even lighter: **no wallet at
all** — a visitor is trading 10 paper ETH in five seconds. And Robinhood Chain is two
months old with retail flooding in: this IS the moment; first-mover in "honest tooling"
is still open.

**Crypto-Twitter mechanics (current algorithm)**: educational/data threads with **no links
in the main tweet** outperform; opinion posts that provoke replies beat announcements;
the fastest reliable path for a new account is a **reply discipline — 20+ substantive,
insight-first replies per day** to established accounts (typical: 1K followers in 1–2
months, 10K in ~6); X Premium materially boosts impressions (~6× in Buffer's 18.8M-post
study); target ≥3–5% engagement rate; brands win by proving technical depth and
responding fast, not by shouting.

The meta-lesson across all three: **be the source of numbers other people argue about.**
Nansen grew on "smart money" wallet threads; Arkham on entity exposés; DexScreener by
being the screenshot in everyone else's posts. Our replay engine generates exactly that
class of content — and nobody on this chain can fake it, fork it quickly, or refute it.

## The plan (simple version)

1. **Repo public** → the README is the credibility artifact.
2. **Deploy** (Railway one-box, dedicated RPC) → a link that works in every post.
3. **X account** + Premium. Bio: *"prove you're not. execution-honest paper trading on
   Robinhood Chain. not real money — real everything else."*
4. **Operate the daily loop** (below) for 30 days before judging anything.

## The daily loop (~30 min + automation)

1. Run `pnpm --filter @paperhands/indexer exec tsx src/main.ts content`
   → writes `content/YYYY-MM-DD.md`: 3–5 paste-ready drafts computed from OUR live data:
   traction movers, rug receipts, a whale replay verdict, an LP lab result, the day's
   worst mark-vs-reality inflation. Pick the 1–2 strongest, screenshot the referenced
   page, post (numbers in the tweet, link in the reply — not the main tweet).
2. **20 replies** to ecosystem accounts (Pons, hood.fun, HOOD10, Delta, chain devs, CT
   data accounts) — always adding a number of ours: a depth, a replay verdict, a
   traction multiple. Replies are the growth engine; posts are the archive.
3. Answer everything on our own posts. Quote-post one trader's win/loss with the honest
   replay attached (no dunking — the numbers are cold enough).

Automation path: the `content` command is deliberately deterministic → later, a
scheduled job (Railway cron or a scheduled agent) can generate the pack and draft posts
automatically; a human stays on the send button.

## Launch thread (post after repo + deploy are live)

1/ everyone thinks they can pick memecoins. we built the place to prove it — with the
one thing every paper-trading app lies about: **your fills.**

2/ PaperHands simulates every trade through Robinhood Chain's actual Uniswap liquidity,
tick by tick. the engine matches the chain's own quoter **wei-for-wei** — receipts in
the repo. 10 fantasy ETH. real everything else.

3/ your position isn't worth price × bags. it's worth what the pool would pay you to
leave. we show both, always. the gap is why people diamond-hand to zero.

4/ the Wire ranks real wallets by ETH actually pulled OUT of pools — not marked bags.
we found one up +105 ETH in a day. looks copyable, right?

5/ so we replayed copying it — every entry, every exit, at retail size, through
recorded history. verdict in the screenshot. now run that test on any wallet yourself,
before you tail them.

6/ also in the lab: would LPing have beaten holding? we replay every recorded swap
through your virtual position and hand you fees vs IL vs hodl. sometimes it's 3,500%
APR. sometimes fees don't cover the bleed. we tell you which, either way.

7/ free. open source. no wallet, no token, not financial advice — that's the point.
come find out if you actually have it. (link below)

## Week one calendar

- D1: launch thread + repo link reply · D2: Replay Files #1 · D3: HOOD10 honesty audit
  thread (marked vs realizable value of their dividend basket) · D4: rug receipt or
  mark-vs-reality · D5: LP Lab result · D6: "how the engine works" dev thread (validation
  receipts, for the builder audience) · D7: week recap + leaderboard screenshot.
- Throughout: 20 replies/day, every day, no exceptions.

## Metrics

One number to optimize: **replay runs** (the shareable act). Secondary: paper accounts,
trades/day, GH stars. Judge nothing before day 30.

## Later plays

- $PAPER Seasons pot on Pons (fees → tokenized-stock prizes) — legal sanity check first
- Postgres → Vercel split when load demands
- Public quotes API for the chain's "agentic trading" crowd
