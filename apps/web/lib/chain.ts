import { makeClient } from '@paperhands/chain'

const g = globalThis as unknown as { __phclient?: ReturnType<typeof makeClient> }
/** One RPC client per server process (survives HMR). */
export const chainClient = (g.__phclient ??= makeClient())
