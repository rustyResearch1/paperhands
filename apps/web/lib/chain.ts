import { makeClient } from '@paperhands/chain'

const g = globalThis as unknown as { __phclient?: ReturnType<typeof makeClient> }
/**
 * One RPC client per server process (survives HMR). The web can use its own
 * endpoint (`PAPERHANDS_RPC_WEB`) so quotes never queue behind the indexer's
 * bulk reads on a shared key; otherwise it shares `PAPERHANDS_RPC`.
 */
export const chainClient = (g.__phclient ??= makeClient(process.env.PAPERHANDS_RPC_WEB ?? process.env.PAPERHANDS_RPC ?? undefined))
