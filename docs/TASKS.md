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
