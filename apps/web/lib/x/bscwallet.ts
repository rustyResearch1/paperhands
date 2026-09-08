import { bscQuote, bscToken } from './bsc'

/**
 * BNB Chain wallet explorer. We don't index BSC, so history comes from the
 * Etherscan V2 API (one free key covers BscScan): normal transactions (BNB
 * out), internal transactions (BNB in) and ERC-20 transfers, grouped by
 * transaction hash and read as swaps. PnL then follows the same pro-rata
 * cost-basis rule as Robinhood Chain, in BNB.
 */
const KEY = process.env.ETHERSCAN_API_KEY ?? process.env.BSCSCAN_API_KEY
const API = 'https://api.etherscan.io/v2/api?chainid=56'
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
export const bscWalletAvailable = Boolean(KEY)

async function scan<T>(params: Record<string, string>): Promise<T[]> {
  const q = new URLSearchParams({ ...params, apikey: KEY ?? '' })
  const res = await fetch(`${API}&${q}`, { cache: 'no-store' })
  const j = (await res.json()) as { status: string; message: string; result: T[] | string }
  if (typeof j.result === 'string') {
    if (/No transactions found/i.test(j.result) || j.message === 'No transactions found') return []
    throw new Error(j.result)
  }
  return j.result
}

interface Tx {
  hash: string
  timeStamp: string
  from: string
  to: string
  value: string
  isError?: string
}
interface TokenTx extends Tx {
  contractAddress: string
  tokenSymbol: string
  tokenDecimal: string
}

export interface BscSwap {
  tx: string
  ts: number
  side: 'buy' | 'sell' | 'swap'
  token: string
  symbol: string
  decimals: number
  qtyRaw: string
  bnb: number
}

export interface BscTokenPnl {
  token: string
  symbol: string
  decimals: number
  buys: number
  sells: number
  bnbIn: number
  bnbOut: number
  realized: number
  openQtyRaw: string
  openQty: number
  openCost: number
  realizableBnb: number | null
  unrealized: number | null
  untracked: boolean
}

export interface BscWallet {
  address: string
  swaps: BscSwap[]
  tokens: BscTokenPnl[]
  realized: number
  unrealized: number | null
  netFlow: number
  volBnb: number
  winRate: number | null
  firstTs: number | null
  lastTs: number | null
}

const cache = new Map<string, { at: number; v: BscWallet }>()

export async function bscWallet(address: string): Promise<BscWallet> {
  const a = address.toLowerCase()
  const hit = cache.get(a)
  if (hit && Date.now() - hit.at < 60_000) return hit.v
  if (!KEY) throw new Error('BSC wallet history needs ETHERSCAN_API_KEY (free at etherscan.io)')
  const base = { address: a, page: '1', offset: '2000', sort: 'asc', module: 'account' }
  const [txs, internal, tokens] = await Promise.all([
    scan<Tx>({ ...base, action: 'txlist' }),
    scan<Tx>({ ...base, action: 'txlistinternal' }).catch(() => [] as Tx[]),
    scan<TokenTx>({ ...base, action: 'tokentx' }),
  ])
  // Per transaction: BNB the wallet paid, BNB it received, tokens in and out.
  const byTx = new Map<string, { ts: number; bnbOut: number; bnbIn: number; tokIn: TokenTx[]; tokOut: TokenTx[] }>()
  const get = (hash: string, ts: number) => {
    let e = byTx.get(hash)
    if (!e) {
      e = { ts, bnbOut: 0, bnbIn: 0, tokIn: [], tokOut: [] }
      byTx.set(hash, e)
    }
    return e
  }
  for (const t of txs) if (t.from.toLowerCase() === a && t.isError !== '1' && Number(t.value) > 0) get(t.hash, Number(t.timeStamp)).bnbOut += Number(t.value) / 1e18
  for (const t of internal) if (t.to.toLowerCase() === a && Number(t.value) > 0) get(t.hash, Number(t.timeStamp)).bnbIn += Number(t.value) / 1e18
  for (const t of tokens) {
    if (t.contractAddress.toLowerCase() === WBNB) {
      // WBNB moving is BNB moving for our purposes.
      if (t.to.toLowerCase() === a) get(t.hash, Number(t.timeStamp)).bnbIn += Number(t.value) / 1e18
      else if (t.from.toLowerCase() === a) get(t.hash, Number(t.timeStamp)).bnbOut += Number(t.value) / 1e18
      continue
    }
    if (t.to.toLowerCase() === a) get(t.hash, Number(t.timeStamp)).tokIn.push(t)
    else if (t.from.toLowerCase() === a) get(t.hash, Number(t.timeStamp)).tokOut.push(t)
  }

  const swaps: BscSwap[] = []
  for (const [hash, e] of byTx) {
    if (e.tokIn.length === 1 && e.tokOut.length === 0 && e.bnbOut > 0) {
      const t = e.tokIn[0]!
      swaps.push({ tx: hash, ts: e.ts, side: 'buy', token: t.contractAddress.toLowerCase(), symbol: t.tokenSymbol, decimals: Number(t.tokenDecimal), qtyRaw: t.value, bnb: e.bnbOut })
    } else if (e.tokOut.length === 1 && e.tokIn.length === 0 && e.bnbIn > 0) {
      const t = e.tokOut[0]!
      swaps.push({ tx: hash, ts: e.ts, side: 'sell', token: t.contractAddress.toLowerCase(), symbol: t.tokenSymbol, decimals: Number(t.tokenDecimal), qtyRaw: t.value, bnb: e.bnbIn })
    } else if (e.tokOut.length === 1 && e.tokIn.length === 1) {
      const o = e.tokOut[0]!
      const i = e.tokIn[0]!
      swaps.push({ tx: hash, ts: e.ts, side: 'swap', token: o.contractAddress.toLowerCase(), symbol: `${o.tokenSymbol}→${i.tokenSymbol}`, decimals: Number(o.tokenDecimal), qtyRaw: o.value, bnb: 0 })
    }
  }
  swaps.sort((x, y) => x.ts - y.ts)

  const byToken = new Map<string, BscTokenPnl & { qty: number }>()
  for (const s of swaps) {
    if (s.side === 'swap') continue
    let t = byToken.get(s.token)
    if (!t) {
      t = { token: s.token, symbol: s.symbol, decimals: s.decimals, buys: 0, sells: 0, bnbIn: 0, bnbOut: 0, realized: 0, openQtyRaw: '0', openQty: 0, openCost: 0, realizableBnb: null, unrealized: null, untracked: false, qty: 0 }
      byToken.set(s.token, t)
    }
    const q = Number(s.qtyRaw)
    if (s.side === 'buy') {
      t.buys++
      t.bnbIn += s.bnb
      t.qty += q
      t.openCost += s.bnb
    } else {
      t.sells++
      t.bnbOut += s.bnb
      if (t.qty <= 0) {
        t.realized += s.bnb
        t.untracked = true
      } else {
        const portion = Math.min(1, q / t.qty)
        const costOut = t.openCost * portion
        t.realized += s.bnb - costOut
        t.openCost -= costOut
        t.qty = Math.max(0, t.qty - q)
      }
    }
  }
  const list: BscTokenPnl[] = []
  for (const t of byToken.values()) {
    const { qty, ...rest } = t
    list.push({ ...rest, openQtyRaw: BigInt(Math.floor(qty)).toString(), openQty: qty / 10 ** t.decimals })
  }
  // Value the biggest open bags at what the venue would pay.
  const open = list.filter((t) => t.openQty > 0).sort((x, y) => y.openCost - x.openCost).slice(0, 6)
  await Promise.all(
    open.map(async (t) => {
      try {
        const q = await bscQuote('sell', t.token, BigInt(t.openQtyRaw))
        if (q.fillRatio >= 0.999) {
          t.realizableBnb = Number(BigInt(q.amountOut)) / 1e18
          t.unrealized = t.realizableBnb - t.openCost
        }
        const meta = await bscToken(t.token).catch(() => null)
        if (meta) t.symbol = meta.symbol
      } catch {
        // unquotable
      }
    }),
  )
  list.sort((x, y) => y.realized + (y.unrealized ?? 0) - (x.realized + (x.unrealized ?? 0)))
  const closed = list.filter((t) => t.sells > 0)
  const valued = list.filter((t) => t.unrealized !== null)
  const v: BscWallet = {
    address: a,
    swaps: swaps.reverse().slice(0, 200),
    tokens: list,
    realized: list.reduce((s, t) => s + t.realized, 0),
    unrealized: valued.length ? valued.reduce((s, t) => s + (t.unrealized ?? 0), 0) : null,
    netFlow: list.reduce((s, t) => s + t.bnbOut - t.bnbIn, 0),
    volBnb: list.reduce((s, t) => s + t.bnbIn + t.bnbOut, 0),
    winRate: closed.length ? closed.filter((t) => t.realized > 0).length / closed.length : null,
    firstTs: swaps.length ? swaps[swaps.length - 1]!.ts : null,
    lastTs: swaps.length ? swaps[0]!.ts : null,
  }
  cache.set(a, { at: Date.now(), v })
  return v
}
