# PaperHands → production: task list

Goal: a competitive Robinhood Chain trading + LP product — practice AND real,
non-custodial execution, deep tech, pristine UI with ambient mathematical motion.

## Stage A — Pristine design system + shell
- [x] Design tokens (light/dark), fonts (Instrument Sans + IBM Plex Mono numerals)
- [x] Ambient three.js background: constant-product contour field, reduced-motion safe
- [x] App shell: nav, Practice/Real mode switch, wallet button (injected connector)
- [x] Restyle: Markets (screener), Trade (token page), Wire, Wallet page, Portfolio, Leaderboard
- [x] Mobile layout pass: no page scrolls horizontally at 375px; Markets/Wire/Leaderboard hide secondary columns on phones

## Stage B — Wallet connect (read-only)
- [x] wagmi + injected connector, chain config for 4663
- [x] Real portfolio: ETH + tracked token balances, valued by pool-would-pay
- [x] Real LP positions (v3 NFPM): range, in-range?, fees owed (IL vs hodl: later)

## Stage C — Real execution (non-custodial, user signs)
- [x] Approvals flow (ERC20 → router)
- [x] Swap: v3 exactInputSingle / exactInput (2-leg via USDG) with our exact minOut
- [x] Swap: v4 via Universal Router (V4_SWAP: chained SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL), hooked pools included;
      Permit2 two-step allowance for sells; wallet-signable routing keeps 2-leg routes inside one protocol version.
      Verified by eth_call + estimateGas of the exact calldata (scripts/sim-real-swap.mts).
      Gotcha found and fixed: this router's ExactInputSingleParams has six fields (sqrtPriceLimitX96) — five-field
      encoding reverts empty on every non-native pool.
- [x] LP mint: v3 NFPM.mint from strategy range
- [x] LP collect (unwrap WETH → ETH, sweep token) and close (decrease + collect + burn) from the portfolio
- [x] Honest pre-trade sheet: fill, impact, price move, instant-exit, route, minOut
- [ ] v4 LP (PositionManager 0x58daec31…) — mint/collect/close for hookless v4 pools.
      Blocker for the read side: v4 PositionManager is ERC721 without enumeration, so listing a wallet's
      positions needs the indexer to track its Transfer events (add to the watch loop first).

## Stage D — LP strategy engine
- [x] Realized-vol range suggester (24h σ → tight/balanced/wide) + backtest on demand
- [x] Strategy chips in the Lab (suggested ranges); templates implied by pool type
- [x] Backtest card on every hookless ETH pool (3h/24h/72h) with verdict
- [x] Alerts feed (Wire + /api/v1/alerts): liquidity pulled ≥50% in one tx, −50% dumps with real volume, ≥4× volume surges;
      out-of-range strip on real LP positions

## Stage E — Public API v1
- [x] /api/v1/quote (best route + legs), /api/v1/pools, /api/v1/depth (impact curve)
- [x] /api/v1/replay, /api/v1/lp
- [x] Rate limiting, /docs page

## Stage F — Deep tech
- [x] Depth/impact curve per pool (chart + API)
- [x] Hook classifier (address permission bits → capabilities + risk), shown on hooked pool pages
- [x] Scheduled self-validation in the watch loop (one busy hookless pool per 30 min while the cursor is within
      pinned state; results in `validations`) → "engine-verified NN%" badge on token pages

## Stage H — Multi-chain best execution (Robinhood Chain · Solana · BSC)
Differentiator: one terminal, honest numbers, best route per chain, cross-chain comparison, real execution everywhere, non-custodial.
- [x] H1 Cross-chain quote layer (`lib/x/`): unified XQuote {fill, impact, route, source, sold-right-back, executable, tx, runner-up}
      · RH = our engine (unchanged) · SOL = Jupiter (all Solana DEXes) + reverse quote for instant exit
      · BSC = PancakeSwap v3 through our exact engine (slot0 + TickLens + tick-walk, verified: 28 routes for CAKE) vs KyberSwap; best wins
- [x] H2 `/api/v1/xquote`, `/api/v1/xtx`, `/api/v1/xcandles`, `/api/v1/xsearch` (+ docs)
- [x] H3 Wallets: EVM injected on BSC (chain 56) via wagmi; Phantom/Solflare/Backpack via the injected `window.solana` provider
- [x] H4 Real execution: SOL = Jupiter swap tx built for the user's pubkey, signed in Phantom (tx build verified) · BSC = PancakeSwap
      SmartRouter calldata (our builder) or KyberSwap calldata, ERC20 approvals per spender (Kyber route eth_call ok, 244k gas)
- [x] H5 Markets per chain (`/x/sol`, `/x/bsc`: GeckoTerminal trending + volume leaders, search) and token pages `/x/[chain]/[token]`
      (chart, pools, honest ticket). LP card: Stage I
- [x] H6 `/x` best execution: the same $100–$10k into USDC/USDG, USDT, ETH, BTC, SOL on every chain → value received, cost/edge in bps,
      impact, gas, who quoted (60s cache)
- [x] H7 Portfolio → Real: Solana (Phantom) + BNB Chain holdings valued by full-size sell quotes (`/api/v1/xvalue`), alongside RH
- [x] H8 Practice ledgers on Solana (10 SOL) + BNB Chain (5 BNB): `/api/xpaper`, fills at the live quote, partial fills refused,
      positions valued by sell quotes on the portfolio (verified: 0.1 SOL → 3.31M Bonk via Whirlpool, valued back at 0.0999 SOL)

## Stage I — Best LP: Robinhood Chain + Solana (+ BSC)
- [x] I1 LP screener `/lp` + `/api/v1/lp/pools`: RH (ledger) · Orca + Meteora (Solana) · PancakeSwap v3 (BSC); fee yield/day, APR,
      vol/TVL, realized σ (our candles / GeckoTerminal minute OHLCV), fee-to-vol score; chain filter
- [x] I2 Range suggester on every screener row (1σ / 2σ / 4σ from realized σ)
- [x] I3a BSC LP execution: PancakeSwap v3 WBNB pools (live depth), σ ranges, exact mint plan, mint / collect / close through
      Pancake's position manager with our builders (`/api/lp/bsc`, LP card on BSC token pages; positions listed per wallet)
- [x] I3b Solana LP execution: Orca Whirlpools SOL pools, σ ranges, open (v2 by-token-amounts with ±1% price band) and close
      transactions built server-side for the user's pubkey and signed in Phantom (`/api/lp/sol`, LP card on Solana token pages;
      verified: 0.5 SOL ±30% on SOL/BONK → 0.214 SOL + 9.43M BONK, 1444-byte tx). Meteora DLMM: later
- [x] I4 Approximate LP backtest for Solana + BSC pools (`/api/lp/xbacktest`, block in both LP cards): volume-share fees from
      minute candles × your share of current in-range liquidity, IL from the price path, time in range, fee APR run-rate
- [ ] I5 Meteora DLMM execution (bin positions) · Raydium CLMM · BSC USDT-quoted LP deposits

## Stage L — Paper-and-ink design (ourolayer.com as the reference)
- [x] Tokens: parchment `#eeebe5` / ink `#1b1710` / bronze accent / deep green up / brick down (warm dark variant too),
      Source Serif 4 headlines, Public Sans body, JetBrains Mono numerals + labels, 8px cards, 6px controls, no glows
- [x] Charts, depth curve and ambient shader read the tokens; wordmark in serif
- [ ] Editorial touches: numbered section eyebrows (01 · Markets…), serif pull-quotes on Learn pages, a proper OG image

## Stage K — Explorer + trencher ergonomics
- [x] Copy-CA pills on every token page and market row (Robinhood, Solana, BSC) and on wallet pages
- [x] Robinhood wallet explorer (`/w/<address>`): realized P&L with pro-rata cost basis, win rate, volume, per-token table,
      open bags valued client-side at what the pool would pay (`/api/v1/xvalue`), swap timeline with prices + tx links, paging,
      Wire rank, stablecoin legs excluded from P&L; wallet search on the Wire
- [x] BSC wallet explorer (`/x/bsc/w/<address>`) from Etherscan V2 (set `ETHERSCAN_API_KEY`): swaps reconstructed from BNB/WBNB + token
      transfers, same P&L rules, open bags valued by our engine / KyberSwap
- [x] Ledger lock hardening: web `busy_timeout` 20s, ephemeral session instead of a 500 under lock, batched retention prune
- [x] Profitable-wallets leaderboard: cost-basis P&L shared with the indexer (`packages/indexer/src/pnl.ts`), `wire_rank` carries
      realized P&L, win rate, wins/losses, best/worst token; Wire sorts by net flow / realized / win rate; wallet page won-on / lost-on
- [x] Alerts precomputed by the watch loop too (the live query was 35s on the production ledger: `liq_events` had no block-leading
      index — added `(kind, block)`); heavy indexer refreshes wait two minutes after boot so page loads get the CPU first
- [x] Scalability without over-engineering: precomputed screener + rankings served even when stale; identical concurrent quotes
      coalesced; at most 8 RPC-heavy quotes in flight (`PAPERHANDS_QUOTE_CONCURRENCY`); per-bag valuation cache; RPC fallback
      transport (dedicated → public); SQLite WAL + 20s busy timeout + batched prune; per-IP rate limits; usage counters
- [ ] Solana wallet explorer (needs a history source: Helius enhanced transactions / DAS — key)
- [ ] Bridge tab via deBridge DLN (supports Robinhood 4663, Solana, BSC; keyless quote + tx build); cross-chain trending list
- [ ] Learn section (live-data lessons + paper challenges)

## Stage M — The Tape (bsctrenches.com as the bar: one live, dense, read-only page a trencher opens first)
- [x] `/tape`: every fill on Robinhood Chain as it lands in the ledger, sized in USD, newest first, 4s polling with `since=<block>`
      deltas; tracked (the 200 ranked wallets, rank badges) / everyone; buys / sells; ≥ $100 / $1k / $10k; sound on new fills
- [x] Header stats: tape lag vs the chain, fills/min + 24h count + 5m buys/sells, 24h traded (screener snapshot), biggest buy and
      sell of the hour with wallet, tracked-wallet count
- [x] Fresh pools rail: newest discovered token pools with version/hook, age, swap count, quote depth
- [x] Closed trades rail: the ranked wallets' sells with realized P&L (pro-rata cost basis), hold time, tx — only closes whose cost
      the ledger actually saw; refreshed with the Wire ranking (`meta.closed_json`, `computeClosedTrades`)
- [x] Ledger indexes for it: `swaps(block)`, `swaps(trader, block)` (replaces the trader-only index), `pools(discovered_block)` —
      built after migrate, tolerant of the other process holding the lock at boot; tape queries fall back when they don't exist yet
- [x] Watcher ticks every 2.5s on a dedicated RPC (6s public) so the tape is seconds behind the chain once `PAPERHANDS_RPC` is set
- [ ] WebSocket push instead of polling (needs the dedicated RPC's WS for the watcher first); "who followed who" (wallets that bought
      the same token within N minutes of a ranked wallet); token market cap on fills (needs total supply per token)

## User-side (needs your accounts / wallet)
- [ ] Set `PAPERHANDS_RPC` on Railway to a dedicated Robinhood Chain endpoint — production still runs on the public RPC
      (rate limits + ~3k blocks of pinned state). Researched 2026-09-08: the watcher is a *sustained* consumer (~5 RPS steady with
      batching, far more on catch-up), so credit-metered free tiers (Alchemy 30M CU/mo, QuickNode 10M credits, Dwellir 100k/day)
      run out in days; dRPC's 210M CU/mo lasts weeks at most. **OrbitFlare** is the only free plan with no monthly cap (10 RPS,
      archive + WebSockets included) → `PAPERHANDS_RPC` = OrbitFlare Free now, Starter ($49/mo, 100 RPS) when the tape should
      run at full chain activity; `PAPERHANDS_RPC_WEB` = dRPC free (bursty quote traffic, 210M CU is plenty). Alchemy is
      Robinhood's official recommendation but its CU metering does not fit an indexer.
- [x] Dedicated-endpoint client: token-bucket cap on HTTP requests (`PAPERHANDS_RPC_RPS`, default 8), JSON-RPC batch size
      (`PAPERHANDS_RPC_BATCH`, default 100; 1 if the provider bills per call), public RPC as fallback; attribution fires 100
      lookups at once so each batch is one request, and names the biggest fills first (quote leg in the token's own decimals,
      ETH ×1000, priced pools only, last 10k blocks — 0.6s on a 20M-row ledger)
- [ ] With the real key: measure RPS at the provider's dashboard vs `PAPERHANDS_RPC_RPS`; if batches bill per call set
      `PAPERHANDS_RPC_BATCH=1` and `PAPERHANDS_ATTRIB_PER_TICK` to what 10 RPS affords (~20/tick); pool-state reads → one multicall
- [ ] First real trade with your own wallet, small size: a v3 buy, a v4 hooked buy, a sell (Permit2 two-step), an LP mint + close.
      Every path is verified by eth_call, but no wallet has signed through the UI yet
- [ ] Set `NEXT_PUBLIC_SITE_URL` + an OG image; create the GitHub repo and the X account (docs/LAUNCH.md)

## Stage G — Prod hardening
- [x] Error boundary, not-found, loading skeleton, OG/Twitter metadata
- [x] Usage counters (API hits per endpoint, replay + LP backtest runs) shown on /docs
- [x] README/docs refresh
- [x] Deploy + smoke test on production (all pages + APIs incl. multi-chain; first scheduled validation on prod: 500 swaps, 100% exact)
- [x] Markets screener precomputed by the watch loop every minute (stored JSON; live query only as fallback) — `/api/health` reports its age

## Stage N — Audit pass (2026-09-09)
Eight-dimension review; four dimensions completed before the budget ran out (UI consistency, performance, correctness,
indexer robustness) and their findings were implemented directly.

Correctness ✓
- [x] cost-basis replay: the "sold more than we saw bought" flag was tested after qty was clamped, so it never fired and
      realized P&L was overstated in silence (fires on 314/713 ranked positions)
- [x] baskets: double unwind credited the bankroll twice — the conditional close is now the guard
- [x] paper orders on Solana/BNB: balance read before an awaited quote, written after it
- [x] attribution/prune: `INDEXED BY` on a late index throws at prepare time and would wedge the tick
- [x] a rate-limited factory check no longer brands a real pool unverified forever
- [x] wallet timeline paging, /api/handle error mapping, paper-portfolio error body

Performance ✓ (single-threaded process: one slow query stalls everyone)
- [x] the big one: cold heavy screens blocked the process (prod /baskets 52s, /x 27s, and /api/tape?stats=1 30s while they
      built). `swrOrNull` + a "still building" card; every page now under 1.4s on the first hit after a deploy
- [x] usage counters buffered in memory instead of a WAL write per request
- [x] tape 24h fills from the watcher snapshot (2.9s → 0.002s); ETH/USD face pool resolved every 10 min
- [x] wire replays each wallet once, not twice; leaderboard return computed from holdings, yields between wallets
- [x] wallet bag valuations batched into one request (was six of a visitor's twenty per minute)
- [x] /api/replay and /api/lp rate-limited; WAL journal_size_limit + TRUNCATE checkpoint; bounded caches
- [x] prune deletes by indexed block instead of scanning 26M rows by ts; backups never leave a raw copy behind

Design system ✓
- [x] primitives moved into @layer base/components — unlayered CSS outranked every Tailwind utility written beside it,
      so `class="card p-6"` silently kept the primitive's padding
- [x] --on-fill token (white-on-light in dark mode), one Kpi/Row, PageHeader, Delta, NavLinks with aria-current
- [x] /x and /docs reachable at last; mobile header controls no longer run off the edge; :focus-visible ring; type scale;
      .txt for categorical table columns; format helpers a dozen pages had re-implemented

Still open from the audit
- [ ] `withFrozenSnapshots` is process-global: while a depth curve computes, other quotes reuse snapshots of any age
- [ ] `rhQuote` forces wallet-signable routing, so read-only valuations exclude ~900 verified v4 pools
- [ ] v4 liq backfill has no resume marker; unresolvable pools retried every tick without a negative cache
- [ ] `ticketQuote` records block '0' on paper trades; block timestamps extrapolate from one anchor
- [ ] four audit dimensions never ran: UX flows, mobile/a11y (partly covered), security, product gaps

## Stage O — /how, the public explainer (2026-09-09)
- [x] `/how` — what we are and how the engine works, in plain language: exact fills vs chart prices (with an SVG of an order
      walking the liquidity ladder), the Uniswap-math port checked wei-for-wei against the chain's quoter, the self-validation
      scoreboard, v3/v4 + protocol fee + hooked pools via the on-chain quoter, refusing partial fills, valuing bags at what a
      pool would pay, factory verification as a filter, published alert thresholds, cross-chain execution
- [x] Proves itself from the ledger (`lib/proof.ts`, swr 5 min, deliberately cheap queries only): pools indexed, v3/v4 split,
      verified vs excluded, 24h fills, and the live % of replayed real swaps the engine reproduced exactly
- [x] Limits stated on the same page as the claims (single-block quotes, no MEV modelling, finite liquidity window,
      "verified" means real not safe, interpolated fill times, paper balances are not money)
- [x] Every claim adversarially fact-checked against the code first; 22/23 survived, and the drafted copy was corrected where
      it overstated (engine scope across chains; the v4 fee story replaced with the protocol surcharge that is actually charged)
- [x] Post-ship fact-check corrections (the pass finished after the page went out): v3 vs v4 validation bar, the exactness
      score's sample, verification filter scope, partial-fill refusal not applying to hooked/Jupiter quotes, and hooked pools
      having no post-trade state
- [ ] Link `/how` from the marketing surfaces once they exist (OG image, landing hero)
- [ ] Consider surfacing the same hooked-pool caveat inline on token pages, where a near-zero price move currently reads as good news
