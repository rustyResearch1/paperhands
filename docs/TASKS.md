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

## Stage G — Prod hardening
- [x] Error boundary, not-found, loading skeleton, OG/Twitter metadata
- [x] Usage counters (API hits per endpoint, replay + LP backtest runs) shown on /docs
- [x] README/docs refresh
- [ ] Deploy + smoke test on production (home, token page, /api/v1/alerts, /docs)
