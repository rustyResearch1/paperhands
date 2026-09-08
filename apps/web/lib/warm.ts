import { compareAcrossChains } from './x/compare'
import { lpScreen } from './x/lp'

/**
 * Keep the two expensive cross-chain pages warm so no visitor waits on a
 * dozen aggregator round-trips. Starts twenty seconds after boot (page loads
 * get the CPU first) and refreshes every four minutes, one job at a time.
 */
const g = globalThis as { __phwarm?: boolean }

export function startWarmup() {
  if (g.__phwarm || process.env.NEXT_PHASE === 'phase-production-build') return
  g.__phwarm = true
  const run = async () => {
    const t0 = Date.now()
    try {
      await lpScreen(['rh', 'sol', 'bsc'])
    } catch {
      // logged by the screener itself
    }
    for (const usd of [500, 100, 2000, 10_000]) {
      try {
        await compareAcrossChains(usd)
      } catch {
        // a venue being down must not stop the loop
      }
    }
    console.log(`warm v2: lp screen + best-execution tables refreshed in ${Date.now() - t0}ms`)
  }
  const t = setTimeout(() => {
    run()
    setInterval(run, 4 * 60_000).unref()
  }, 20_000)
  t.unref()
}
