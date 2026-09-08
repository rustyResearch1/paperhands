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
- [ ] H1 Cross-chain quote layer (`lib/x/`): unified XQuote {fill, impact, route, source, sold-right-back, executable, tx}
      · RH = our engine (unchanged) · SOL = Jupiter (all Solana DEXes) + reverse quote for instant exit
      · BSC = PancakeSwap v3 through our exact engine (fork of Uniswap v3: slot0 + TickLens + tick-walk) vs aggregator; best wins
- [ ] H2 `/api/v1/xquote?chain=rh|sol|bsc` public endpoint (+ docs)
- [ ] H3 Wallets: EVM injected on BSC (chain 56) via wagmi; Phantom/Solflare via the wallet-standard `window.solana` provider
- [ ] H4 Real execution: SOL = Jupiter swap tx (built for the user's pubkey, signed in Phantom) · BSC = PancakeSwap SmartRouter calldata
      (our SwapRouter02 builder, Pancake addresses) with ERC20 approvals; aggregator route as fallback
- [ ] H5 Markets per chain (GeckoTerminal trending + DexScreener) with the honesty columns; token pages `/x/[chain]/[token]`
      with chart (GeckoTerminal OHLCV), honest ticket, real execution, LP card
- [ ] H6 Cross-chain best-execution view: same asset (USDC/USDT/ETH/BTC/SOL/BNB), same USD size → fill + impact + gas on every chain
- [ ] H7 Portfolio: BSC + Solana holdings valued at what the aggregator would pay (Jupiter / engine), alongside RH

## Stage I — Best LP: Robinhood Chain + Solana (+ BSC)
- [ ] I1 LP screener `/lp`: RH pools (our ledger) · Solana Orca Whirlpools + Meteora DLMM (their APIs) · BSC PancakeSwap v3;
      ranked by fee yield (24h fees / TVL), volume/TVL, realized σ (minute OHLCV) → fee-to-vol score
- [ ] I2 Range suggester for any pool (σ from OHLCV) → tight / balanced / wide, with expected in-range probability
- [ ] I3 LP execution: BSC PancakeSwap v3 NFPM mint / collect / close (our builders, Pancake addresses);
      Solana Orca Whirlpools open/close position (tx built server-side for the user's pubkey, signed in Phantom); Meteora DLMM after
- [ ] I4 LP backtest beyond RH: volume-share backtest from minute OHLCV + current in-range liquidity (labelled approximate)

## User-side (needs your accounts / wallet)
- [ ] Set `PAPERHANDS_RPC` on Railway to a dedicated Alchemy/QuickNode Robinhood Chain endpoint — production still runs on the
      public RPC (rate limits + ~3k blocks of pinned state)
- [ ] First real trade with your own wallet, small size: a v3 buy, a v4 hooked buy, a sell (Permit2 two-step), an LP mint + close.
      Every path is verified by eth_call, but no wallet has signed through the UI yet
- [ ] Set `NEXT_PUBLIC_SITE_URL` + an OG image; create the GitHub repo and the X account (docs/LAUNCH.md)

## Stage G — Prod hardening
- [x] Error boundary, not-found, loading skeleton, OG/Twitter metadata
- [x] Usage counters (API hits per endpoint, replay + LP backtest runs) shown on /docs
- [x] README/docs refresh
- [ ] Deploy + smoke test on production (home, token page, /api/v1/alerts, /docs)
