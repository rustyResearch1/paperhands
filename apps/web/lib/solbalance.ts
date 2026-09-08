/** Read-only Solana balance helpers over the public RPC (browser-safe). */
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j = (await res.json()) as { result?: T; error?: { message: string } }
  if (j.error) throw new Error(j.error.message)
  return j.result as T
}

export async function solBalanceLamports(pubkey: string): Promise<bigint> {
  const r = await rpc<{ value: number }>('getBalance', [pubkey, { commitment: 'confirmed' }])
  return BigInt(r.value)
}

/** Raw token units across every token account the wallet holds for the mint. */
export async function splBalance(pubkey: string, mint: string): Promise<bigint> {
  const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>('getTokenAccountsByOwner', [
    pubkey,
    { mint },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ])
  return r.value.reduce((acc, a) => acc + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n)
}

export interface SplHolding {
  mint: string
  amount: bigint
  decimals: number
}

export async function splHoldings(pubkey: string): Promise<SplHolding[]> {
  const out: SplHolding[] = []
  for (const programId of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
    const r = await rpc<{ value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } }[] }>('getTokenAccountsByOwner', [
      pubkey,
      { programId },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]).catch(() => ({ value: [] }))
    for (const a of r.value) {
      const info = a.account.data.parsed.info
      const amount = BigInt(info.tokenAmount.amount)
      if (amount > 0n) out.push({ mint: info.mint, amount, decimals: info.tokenAmount.decimals })
    }
  }
  return out
}
