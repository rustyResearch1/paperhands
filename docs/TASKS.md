# PaperHands → production: task list

Goal: a competitive Robinhood Chain trading + LP product — practice AND real,
non-custodial execution, deep tech, pristine UI with ambient mathematical motion.

## Stage A — Pristine design system + shell
- [x] Design tokens (light/dark), fonts (Instrument Sans + IBM Plex Mono numerals)
- [x] Ambient three.js background: constant-product contour field, reduced-motion safe
- [x] App shell: nav, Practice/Real mode switch, wallet button (injected connector)
- [x] Restyle: Markets (screener), Trade (token page), Wire, Wallet page, Portfolio, Leaderboard
- [ ] Mobile layout pass (bottom tab nav in; tables scroll; verify on a phone)

## Stage B — Wallet connect (read-only)
- [x] wagmi + injected connector, chain config for 4663
- [x] Real portfolio: ETH + tracked token balances, valued by pool-would-pay
- [x] Real LP positions (v3 NFPM): range, in-range?, fees owed (IL vs hodl: later)

## Stage C — Real execution (non-custodial, user signs)
- [x] Approvals flow (ERC20 → router)
- [x] Swap: v3 exactInputSingle / exactInput (2-leg via USDG) with our exact minOut
- [ ] Swap: v4 single-hop via Universal Router (V4_SWAP: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL)
- [ ] LP mint: v3 NFPM.mint from strategy range; collect / decrease / burn
- [x] Honest pre-trade sheet: fill, impact, price move, instant-exit, route, minOut

## Stage D — LP strategy engine
- [ ] Realized-vol range suggester (from candles) + expected fee APR from replay
- [ ] Strategy templates: stock tight-range, 1% memecoin ±30%, full-range
- [ ] Backtest card on every pool (24h/72h) with verdict
- [ ] Out-of-range + rug-signal alerts feed

## Stage E — Public API v1
- [x] /api/v1/quote (best route + legs), /api/v1/pools, /api/v1/depth (impact curve)
- [x] /api/v1/replay, /api/v1/lp
- [x] Rate limiting, /docs page

## Stage F — Deep tech
- [ ] Depth/impact curve per pool (chart + API)
- [ ] Hook classifier (permission flags → capabilities), shown on pool pages
- [ ] Replay-validate on CI-ish schedule; validation badges on pools

## Stage G — Prod hardening
- [ ] Error boundaries, empty/loading states, SEO/OG, analytics counters (replay runs)
- [ ] README/docs refresh, deploy, smoke test on production
