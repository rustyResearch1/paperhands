import { db } from './db'

/** Latest scheduled replay-validation for a pool (see indexer validate.ts). */
export interface PoolValidation {
  swaps: number
  liqEvents: number
  exactOutRate: number
  exactPriceRate: number
  ranAt: number
  error: string | null
}

export function poolValidation(pool: string): PoolValidation | null {
  try {
    const r = db
      .prepare(`SELECT swaps, liq_events, exact_out, exact_price, ran_at, error FROM validations WHERE pool = ?`)
      .get(pool.toLowerCase()) as { swaps: number; liq_events: number; exact_out: number; exact_price: number; ran_at: number; error: string | null } | undefined
    if (!r) return null
    return {
      swaps: r.swaps,
      liqEvents: r.liq_events,
      exactOutRate: r.swaps > 0 ? r.exact_out / r.swaps : 0,
      exactPriceRate: r.swaps > 0 ? r.exact_price / r.swaps : 0,
      ranAt: r.ran_at,
      error: r.error,
    }
  } catch {
    return null // table not created yet
  }
}
