# PaperHands — handoff (2026-09-12)

An execution-honest trading terminal for Robinhood Chain (chain id 4663, an Arbitrum Orbit L2 running
Uniswap v3/v4), extended to Solana and BNB Chain for best execution, with a live tape, a wallet explorer,
LP tools, paper "Baskets", and — as of today — the PONS launchpad. Everything real-money is non-custodial:
the user signs in their own wallet; we never hold keys or funds.

- Production: https://paperhands-production.up.railway.app (Railway one-box: indexer + Next.js web, SQLite on a volume at `/data`)
- Repo: https://github.com/rustyResearch1/paperhands (`main`; every commit today is pushed)
- Deploy: `railway up --detach` from the repo root. **Verify with `railway deployment list` (SUCCESS/FAILED), never with
  `/api/health` alone** — health answers from the previous container, so a failed build looks fine. `railway logs --build <id>` shows why a build died.
- Health: `/api/health` → `{ok, cursor, pools, wireRankAgeSec, screenerAgeSec, dedicatedRpc, deployment}`. `deployment` is the
  Railway deployment id actually serving — use it to confirm which commit is live.
- Living task list with every stage: `docs/TASKS.md`. Launch playbook: `docs/LAUNCH.md`. Public explainer: `/how`.

## 1. Architecture in one screen

```
packages/engine    bigint port of Uniswap v3 core maths (FullMath/TickMath/SqrtPriceMath/SwapMath + swap loop);
                   validated wei-for-wei vs the chain's QuoterV2 (v3) — v4 tolerates sub-1e-12 dust (validateV4.ts)
packages/chain     viem client (makeClient: dedicated RPC w/ batching + token-bucket + public fallback), pool readers
                   (TickLens words / v4 StateView), addresses, ABIs, redact() for credentials in logs
packages/indexer   the ledger (SQLite, WAL). watch.ts = the tick loop: swaps (v3 topic-filtered, v4 PoolManager
                   address-filtered) → ingest → liq events → PONS (pons.ts) → attribution (biggest fills first) →
                   tails → prune/backup → cursor → screener/alerts (60s) → wire rank + baskets + closed trades (10 min)
                   → replay self-validation (30 min). pnl.ts = cost-basis replay (swaps + curve trades merged).
apps/web           Next.js 15 app router. lib/* is the read layer over the same SQLite (better-sqlite3 is SYNCHRONOUS —
                   see gotchas). Pages: / (markets) /tape /launches /launch/[token] /baskets /w/[address] /w/[address]/basket
                   /wire /lp /x /x/[chain] /x/[chain]/[token] /t/[pool] /portfolio /leaderboard /docs /how
```

Key tables: `pools`, `tokens`, `swaps` (tx_hash+log_index PK; `trader` filled by attribution), `candles` (minute marks),
`liq_events`, `meta` (cursor, snapshots as JSON: screener_json, alerts_json, closed_json, baskets_json), `wire_rank`,
`validations`, `users`/`positions`/`paper_trades` (RH paper), `x_*` (SOL/BSC paper), `basket_positions`,
`launches` + `curve_trades` (PONS), `kol_tails`, `counters`.

Precompute-in-watcher pattern: anything that needs a per-wallet replay or a table scan is computed by the watcher and
stored in `meta`/tables; the web reads it and serves stale rather than recomputing (`storedSnapshot`, `wire_rank`,
`baskets_json`). Heavy cross-chain screens use `lib/swr.ts` (`swr` = stale-while-revalidate, `swrOrNull` = never block
on a cold key; pages render a `Warming` card) plus `instrumentation.ts` → `lib/warm.ts` boot warm-up.

## 2. Complete (live on production)

**Robinhood Chain trading** — token pages (charts, impact curve, hooks), practice bankroll (10 ETH) filled through the
exact engine, real trades signed from the wallet (v3 via SwapRouter02, v4 via Universal Router incl. chained singles,
Permit2), rejects partial fills instead of pretending, "sold right back" retention + markInflation.

**Multi-chain best execution** — `/x`: same dollars into the same asset on RH/Solana/BSC. Solana = Jupiter lite API
(keyless), BSC = our engine on PancakeSwap v3 vs KyberSwap (best wins, runner-up shown). Paper ledgers per chain.
Phantom + wagmi wallets.

**LP** — screener across RH ledger, Orca, Meteora, PancakeSwap ranked by fee-to-vol (fee yield/day ÷ realized σ);
LP backtest that re-executes recorded swaps through a hypothetical range (trace-based, only the slice that crossed
the range earns); real mint/collect/close on RH v3 (NFPM) and BSC (Pancake NFPM); Orca open/close (Whirlpools SDK).
All real LP paths verified by eth_call simulation only.

**The Tape** (`/tape`) — live fills polled every 4s by block delta; tracked (Wire top 200) / everyone / **launchpad**
streams; side + size filters; fresh pools; ranked wallets' closed trades (only closes with a known cost basis);
header stats from stored snapshots; sound.

**Wallet explorer** (`/w/[address]`) — replayed cost-basis P&L, won-on/lost-on, open bags valued at what the pool
would pay (client-side, batched), swap + curve timeline, partial-cost-basis flag surfaced. `/wire` leaderboard,
whale replay lab, tails. BSC wallet explorer via Etherscan V2 (needs `ETHERSCAN_API_KEY`).

**Baskets** (`/baskets`, `/w/[address]/basket`) — a ranked wallet's open bags as a weighted index, the basket priced
back 7/14/30 days, paper backing/unwind on the practice bankroll (double-unwind safe), backers leaderboard precomputed
in the watcher. **Paper only — no contract, no vault, no token.**

**PONS launchpad** (`/launches`, `/launch/[token]`, Tape "launchpad", wallet P&L) — see §4.

**Platform** — public API (`/docs`, 60 req/min/IP), alerts (thresholds published on `/how`), rate limits, usage
counters (buffered), credential redaction in logs, health endpoint, WAL checkpointing, bounded caches, boot warm-up,
`swrOrNull` cold-page pattern, design system in Tailwind layers (Kpi/PageHeader/Delta/NavLinks/Warming), a11y focus
ring, mobile header/bottom nav, `/how` explainer whose claims were adversarially fact-checked against the code.

**Production numbers (settled container):** every page 0.7–2.1s; first hits after a deploy under 3s; watcher fully
ingesting every tick on the public RPC with size-first attribution (≈80% of >$1k fills named within minutes).

## 3. Not done / open (prioritised)

### 3.1 Blocked on the user (nothing else unblocks these)
1. **Dedicated RPC.** OrbitFlare "Robinhood Free" is Active (10 RPS, WSS, no monthly cap), API-key mode, linked to
   @rustyResearch1. The user must set on Railway: `PAPERHANDS_RPC=https://robinhood.rpc.orbitflare.com?api_key=<ORBIT-…>`
   (never in a `NEXT_PUBLIC_*` var). Health `dedicatedRpc` flips true; the watcher moves to 2.5s ticks, 100-call
   batches, 3000 attributions/tick. Then: measure real RPS vs `PAPERHANDS_RPC_RPS` (default 8) and whether the provider
   bills a JSON-RPC batch as 1 request; if per-call, set `PAPERHANDS_RPC_BATCH=1` and `PAPERHANDS_ATTRIB_PER_TICK≈20`,
   or move to the $49 Starter (100 RPS). Optional `PAPERHANDS_RPC_WEB` (dRPC free) keeps web quotes off the indexer key.
2. **First real signed trades** on each path (v3 buy, v4 hooked buy, Permit2 sell, LP mint+close, Orca open, Pancake).
   Every path is eth_call-verified; no human has signed through the UI.
3. `ETHERSCAN_API_KEY` (BSC wallet explorer), `NEXT_PUBLIC_SITE_URL` + an OG image, X account content (drafts in
   `docs/LAUNCH.md`), error monitoring (none configured).

### 3.2 Requested by the user, designed but not built
**A. Paper LP + real LP iteration ("add and play with LP", paper and real).**
- Data: `lp_positions(id, user_id, chain, pool, tick_lower, tick_upper, liquidity TEXT, entry_sqrt_price TEXT,
  entry_block, entry_amount0/1, quote_in, opened_ts, closed_ts, exit_amount0/1, fees0/1)`.
- Open (paper): reuse `packages/indexer/src/lab.ts` `lpBacktest` entry maths (probe liquidity for `quoteWei` at the
  range, `getAmountsForLiquidity`) at the CURRENT block via `readPoolState`; debit the practice bankroll.
- Mark (paper): fees since entry = replay recorded swaps from `entry_block` through the engine with `{trace:true}`
  and credit only the segments inside the range (exactly what `lpBacktest` does today, but forward from a stored
  entry); value = `getAmountsForLiquidity` at the current sqrtPrice; IL vs hold; APR run-rate. Compute in the
  watcher every N minutes per open position and store (do NOT compute on a page request).
- Close (paper): value at current state → credit bankroll; store exit amounts.
- Real: `RealLpMint` / `LpActions` already build NFPM mint/collect/close for RH v3 and Pancake, Orca via
  `lib/x/sollp.ts`. Missing: v4 PositionManager mint (`0x58daec31…`, unused), Meteora DLMM, Raydium CLMM
  (Raydium has a keyless API: `https://api-v3.raydium.io/pools/info/...` + SDK v2 for position txs).
- UI: an "LP ticket" on `/t/[pool]` with Practice/Real modes mirroring the trade ticket; Portfolio → "LP positions"
  (paper + real side by side, fees accrued, IL, range status in/out, "close" action).
**B. Staking / restaking + a knowledge engine ("Learn").**
- Robinhood Chain has no native staking; the DeFi surface is Uniswap LP, PONS curves, and perps venues (Lighter, Arcus).
  A Learn section should teach with live data from our ledger: concentrated-liquidity ranges (use `/lp` σ data), fee
  vs IL (use the backtest), bonding curves (use `/launch` snipe-tax decay), cost basis (use a real wallet), and an
  honest primer on staking/restaking with paper challenges. Lessons as MDX under `apps/web/app/learn/*`, each with a
  "try it on a real pool" link. Stage K item "Learn section" in TASKS.md.
- Restaking/LST on this chain: none verified. Do not invent; if the user wants it, source protocols first.

### 3.3 Product gaps (from research on competing tools: FOMO, GMGN, Axiom, BasedBot, Maestro, Ruginhood, HoodScan)
- **Token risk scanner (Ruginhood-like)** — we already have simulated sells, depth, factory verification, hook flag.
  Add: honeypot check (eth_call a tiny buy→sell round trip via the router; compare to engine output), holder
  concentration (Blockscout token-holders endpoint is free), LP lock status (NFPM position ownership / PONS graduates
  are locked by construction), contract permissions (verified source scan).
- **Wallet tracking with push** — watchlists exist (`kol_tails`); add Telegram bot alerts on tracked wallets' buys.
- **WebSocket push** for the tape (OrbitFlare WSS `wss://robinhood.rpc.orbitflare.com` once the key is set).
- **Auto TP/SL** — paper first (watcher checks marks), real needs Permit2-signed intents + a keeper (design carefully).
- **PONS follow-ups** (TASKS.md Stage P): alerts (graduating ≥90%, serial-deployer relaunch, deployer selling into his
  own curve), stock-quoted launches in the P&L replay (convert quote leg via `quoteTokenUsd`), real curve buy/sell
  ticket (curve.buy/sell are plain calls; snipe-tax aware), deployer clustering.
- **Baskets → on-chain** — v4 hook pool whose fee buys the basket, vault, opt-in + fee share, depth caps, audits,
  counsel (this is a pooled investment vehicle; treat as serious).
- Audit dimensions that never ran (credits): UX flows, security, product gaps, most of a11y. Open findings in Stage N.

## 4. PONS launchpad — what the next agent must know (built today)
- V2 factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (verified source on robinhoodchain.blockscout.com; curl is
  Cloudflare-blocked — read `/api/v2/smart-contracts/<addr>` in a real browser). V1 factory is dead.
- Events: `TokenLaunched(token, curve, deployer indexed; pairToken, launchConfigId, graduationThreshold)`,
  `PoolGraduated(token indexed; positionId, tokenAmount, pairTokenAmount)`; per-launch curve contract emits
  `CurveBuy(buyer, recipient indexed; quoteIn, tokensOut, fee, tax)` / `CurveSell(seller, recipient indexed; tokensIn,
  quoteOut, fee, tax)`. **The trader is in the event — attribution is free.** Selectors in `pons.ts`.
- Curve maths (ported, `curveAmountOut`, `snipeTaxBpsAt`): constant product on `phantomQuote + trackedQuote −
  feeBalance − taxBalance` vs `trackedTokens`; buy takes `feeBps`, `creatorTaxBps`, then a snipe tax
  `startBps >> (elapsed*14/window)` (window = 3s) off the input; sell mirrors it on the way out.
- Graduation at `graduationThreshold` (per launch config: 4.2 ETH common, 42 ETH seen, 24.2 GOOGL…) → locked v4 pool
  under the meme hook `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` (= our most common hook, ~3.4k pools). The token
  keeps its address, so curve buys + pool sells replay as one position (`pnl.ts curveRows`).
- **Launches are quoted in ETH, USDG, or tokenized stocks** (NVDA, GOOGL, TSLA, USO, GME, DJT, AAPL, SPY, F, MSFT…).
  Always carry pair decimals (USDG 6, cbBTC 8) and price via `lib/launches.ts quoteTokenUsd` (ETH from the USDG face
  pool, USDG = 1, stocks from their deepest priced pool). Stock-quoted launches are excluded from the ETH P&L replay.
- Volume: ~12 launches/min, ~490 curve trades/min. Watcher ingests per tick (`fetchPonsLogs`/`ingestPons`);
  `pons-backfill [blocks]` CLI for history; curves seen trading before our first block are registered lazily
  (bounded per tick). Curve live state for the quote box: immutables cached 6h, 4 live reads (public RPC limiter).

## 5. Gotchas that cost real time (do not relearn)
- **better-sqlite3 is synchronous and the web is one process**: any uncached heavy query on a page path stalls every
  request. Never `await` a heavy build in a server component — use `swrOrNull` + `Warming`, or precompute in the watcher.
- `INDEXED BY <late index>` throws at PREPARE time while that index is still building → gate on `hasIndex()`.
- `busy_timeout` must be the first pragma in `openDb` (several `next build` workers open the DB and migrate at once).
- CSS primitives must live in `@layer components`; unlayered CSS silently defeats every Tailwind utility beside it.
- `instrumentation.ts` must use the literal `if (process.env.NEXT_RUNTIME === 'nodejs')` around a dynamic import, and
  caches it warms must live on `globalThis` (separate bundles).
- Public RPC: no JSON-RPC batching, ~3k blocks of pinned state, per-minute limiter ("Rate Limit Hit, limit will reset
  in 60 seconds"); watcher backs off 6s→60s. viem puts the request URL (with `?api_key=`) in error messages → `redact()`.
- Cost-basis replay: the "sold more than we saw bought" flag must be evaluated before the qty clamp.
- Hooked v4 pools are quoted by the chain's v4 Quoter: no post-trade state, so "moves the pool"/"sold right back" are
  unmeasurable there (near-zero move on a hooked pool = unknown, not good). Not yet surfaced inline on token pages.
- The replay exactness score (~93%) is a rotating sample of the busiest replayable hookless pools — never quote it as
  market-wide (`/how` states the sample).
- Local dev: `next dev` on :3000 dies between sessions (preview "stopped by the app"); restart via the launch config
  `paperhands-web`. Installing deps while it runs corrupts the module graph. tsx scripts must run from a package dir.
- Railway volume = one container: each deploy has a 1–3 min swap; a 502/slow first hit during the swap is not a regression.

## 6. How to verify things
```bash
# typecheck (from each package)
cd packages/indexer && pnpm exec tsc --noEmit -p tsconfig.json
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json
# engine vs chain quoter, live
cd packages/chain && pnpm validate
# deploy + confirm
railway up --detach && railway deployment list | head -3 && curl -s https://paperhands-production.up.railway.app/api/health
# watcher health (look for full ingest, pons counts, no 'tick failed' streaks)
railway logs | grep -E "blocks→|tick failed|pons:" | tail
# launchpad data
curl -s "https://paperhands-production.up.railway.app/api/launches?feed=trending&limit=5"
```
Env vars in code: `PAPERHANDS_RPC`, `PAPERHANDS_RPC_WEB`, `PAPERHANDS_RPC_RPS`, `PAPERHANDS_RPC_BATCH`,
`PAPERHANDS_ATTRIB_PER_TICK`, `PAPERHANDS_QUOTE_CONCURRENCY`, `PAPERHANDS_RETAIN_DAYS`, `PAPERHANDS_BUSY_TIMEOUT_MS`,
`PAPERHANDS_DB`, `PAPERHANDS_SECRET` (cookie signing), `ETHERSCAN_API_KEY`, `BSCSCAN_API_KEY`, `BSC_RPC`, `SOLANA_RPC`,
`JUPITER_API`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_PAPERHANDS_RPC` (browser wagmi transport — public URL only),
`NEXT_PUBLIC_BSC_RPC`, `NEXT_PUBLIC_SOLANA_RPC`. Never put a keyed URL in a `NEXT_PUBLIC_*` variable.
