import { db } from './db'

/**
 * Uniswap v4 hook classifier. A hook's permissions are literally its address:
 * the low 14 bits say which callbacks the PoolManager will invoke, and the
 * four "returns delta" bits say whether the hook may move value on that
 * callback. That is enough to say what a hook *can* do to you before reading
 * a line of its code.
 */
export const HOOKLESS = '0x0000000000000000000000000000000000000000'
export const DYNAMIC_FEE_FLAG = 0x800000

const FLAGS = [
  { bit: 13, key: 'beforeInitialize', label: 'before initialize' },
  { bit: 12, key: 'afterInitialize', label: 'after initialize' },
  { bit: 11, key: 'beforeAddLiquidity', label: 'before add liquidity' },
  { bit: 10, key: 'afterAddLiquidity', label: 'after add liquidity' },
  { bit: 9, key: 'beforeRemoveLiquidity', label: 'before remove liquidity' },
  { bit: 8, key: 'afterRemoveLiquidity', label: 'after remove liquidity' },
  { bit: 7, key: 'beforeSwap', label: 'before swap' },
  { bit: 6, key: 'afterSwap', label: 'after swap' },
  { bit: 5, key: 'beforeDonate', label: 'before donate' },
  { bit: 4, key: 'afterDonate', label: 'after donate' },
  { bit: 3, key: 'beforeSwapReturnsDelta', label: 'before swap · returns delta' },
  { bit: 2, key: 'afterSwapReturnsDelta', label: 'after swap · returns delta' },
  { bit: 1, key: 'afterAddLiquidityReturnsDelta', label: 'after add liquidity · returns delta' },
  { bit: 0, key: 'afterRemoveLiquidityReturnsDelta', label: 'after remove liquidity · returns delta' },
] as const

export type HookFlag = (typeof FLAGS)[number]['key']
export type Tone = 'up' | 'warn' | 'down' | 'neutral'

export interface HookCapability {
  label: string
  tone: Tone
  why: string
}

export interface HookProfile {
  address: string
  flags: { key: HookFlag; label: string }[]
  dynamicFee: boolean
  capabilities: HookCapability[]
  risk: 'low' | 'medium' | 'high'
  riskWhy: string
  /** Adoption on this chain — a hook used by thousands of pools is a launchpad, not a one-off. */
  poolCount: number
  swapCount: number
}

export function hookFlags(address: string): Set<HookFlag> {
  const low = Number(BigInt(address) & 0x3fffn)
  const set = new Set<HookFlag>()
  for (const f of FLAGS) if (low & (1 << f.bit)) set.add(f.key)
  return set
}

export function classifyHook(address: string, fee: number): HookProfile {
  const addr = address.toLowerCase()
  const has = hookFlags(addr)
  const dynamicFee = fee >= DYNAMIC_FEE_FLAG
  const caps: HookCapability[] = []

  const takesSwapDelta = has.has('beforeSwapReturnsDelta') || has.has('afterSwapReturnsDelta')
  if (takesSwapDelta)
    caps.push({
      label: 'takes a cut of swaps',
      tone: 'warn',
      why: 'The hook may add or remove value on every swap. Our fills for this pool come from the on-chain quoter, so whatever it takes is already in the number you see.',
    })
  if (has.has('beforeSwap') && dynamicFee)
    caps.push({
      label: 'sets its own fee per swap',
      tone: 'warn',
      why: 'Dynamic-fee pool: the hook picks the LP fee at swap time. It can be 0 or 100%, and it can differ by direction, size or sender.',
    })
  if (has.has('beforeSwap') && !takesSwapDelta && !dynamicFee)
    caps.push({
      label: 'can veto or reshape swaps',
      tone: 'warn',
      why: 'A beforeSwap hook runs before every trade and may revert — for some senders, sizes or time windows. Quotes can succeed and the real swap still fail.',
    })
  if (has.has('beforeRemoveLiquidity'))
    caps.push({
      label: 'can block LP withdrawals',
      tone: 'down',
      why: 'The hook runs before any liquidity removal and may refuse it. On launchpad hooks the hook itself is the only LP; for anyone else this is the exit being controlled by someone else.',
    })
  if (has.has('beforeAddLiquidity'))
    caps.push({
      label: 'gates who can add liquidity',
      tone: 'neutral',
      why: 'Usually means the hook (or its launchpad) is the sole LP — no one else can dilute or front-run the curve. It also means you cannot LP here.',
    })
  if (has.has('afterAddLiquidityReturnsDelta') || has.has('afterRemoveLiquidityReturnsDelta'))
    caps.push({
      label: 'charges LP entries or exits',
      tone: 'warn',
      why: 'The hook can take value when liquidity is added or removed — an LP-side fee on top of the swap fee.',
    })
  if (has.has('afterSwap') && !takesSwapDelta)
    caps.push({
      label: 'observes swaps',
      tone: 'neutral',
      why: 'afterSwap without a delta cannot move value. Typical for oracles, points and accounting.',
    })
  if (has.has('beforeInitialize') || has.has('afterInitialize'))
    caps.push({
      label: 'controls pool creation',
      tone: 'neutral',
      why: 'Only pools the hook agrees to can be created with it — the launchpad pattern.',
    })
  if (has.has('beforeDonate') || has.has('afterDonate'))
    caps.push({ label: 'handles donations', tone: 'neutral', why: 'Reacts to direct donations into the pool (rare).' })

  let risk: HookProfile['risk'] = 'low'
  let riskWhy = 'Only after-the-fact callbacks with no value movement. The hook can watch, not touch.'
  if (has.has('beforeRemoveLiquidity') || has.has('beforeSwapReturnsDelta')) {
    risk = 'high'
    riskWhy = has.has('beforeRemoveLiquidity')
      ? 'Can refuse liquidity removals. Whoever controls the hook controls the exit for LPs.'
      : 'Can rewrite the swap before it happens, including how much you pay.'
  } else if (takesSwapDelta || has.has('beforeSwap') || has.has('beforeAddLiquidity') || dynamicFee) {
    risk = 'medium'
    riskWhy = 'Can take from swaps or block them, but cannot trap liquidity. Trade only through quotes that go on-chain.'
  }

  const stats = db
    .prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(swap_count), 0) AS s FROM pools WHERE version = 4 AND hooks = ?`)
    .get(addr) as { c: number; s: number }

  return {
    address: addr,
    flags: FLAGS.filter((f) => has.has(f.key)).map((f) => ({ key: f.key, label: f.label })),
    dynamicFee,
    capabilities: caps,
    risk,
    riskWhy,
    poolCount: stats.c,
    swapCount: stats.s,
  }
}
