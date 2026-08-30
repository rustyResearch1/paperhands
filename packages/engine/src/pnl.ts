/**
 * Average-cost position accounting in exact raw units. Quote units are
 * whatever the position is denominated in (WETH wei, USDG units, ...).
 */
export interface Position {
  /** Base token quantity held, raw units. */
  qty: bigint
  /** Total quote paid for the current qty (average-cost basis). */
  costQuote: bigint
  /** Cumulative realized PnL in quote units. */
  realizedQuote: bigint
}

export const EMPTY_POSITION: Position = { qty: 0n, costQuote: 0n, realizedQuote: 0n }

export function applyBuy(pos: Position, qtyBought: bigint, quoteSpent: bigint): Position {
  if (qtyBought < 0n || quoteSpent < 0n) throw new Error('applyBuy: negative amounts')
  return {
    qty: pos.qty + qtyBought,
    costQuote: pos.costQuote + quoteSpent,
    realizedQuote: pos.realizedQuote,
  }
}

export function applySell(pos: Position, qtySold: bigint, quoteReceived: bigint): Position {
  if (qtySold <= 0n) throw new Error('applySell: nothing sold')
  if (qtySold > pos.qty) throw new Error('applySell: selling more than held')
  // Round basis up (capped at the full basis) so dust-sized sells can't
  // realize proceeds against a floor-truncated zero basis.
  const num = pos.costQuote * qtySold
  let basisRemoved = num / pos.qty + (num % pos.qty === 0n ? 0n : 1n)
  if (basisRemoved > pos.costQuote) basisRemoved = pos.costQuote
  return {
    qty: pos.qty - qtySold,
    costQuote: pos.costQuote - basisRemoved,
    realizedQuote: pos.realizedQuote + quoteReceived - basisRemoved,
  }
}

/** Unrealized PnL given what the pool would actually pay to exit the position now. */
export function unrealizedQuote(pos: Position, realizableQuote: bigint): bigint {
  return realizableQuote - pos.costQuote
}
