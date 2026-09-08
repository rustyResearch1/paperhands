/**
 * Tokenized stocks on Robinhood Chain carry issuer transfer restrictions
 * (jurisdiction / eligibility enforced in the token contract). The engine
 * quotes them like anything else; real execution can revert for an
 * ineligible wallet, so the UI says so up front. Recognized by issuer naming.
 */
const ISSUER_MARKS = ['• Robinhood Token', 'xStock', '(Ondo Tokenized)', 'Dinari']

export function isTokenizedStock(name: string | null | undefined): boolean {
  if (!name) return false
  return ISSUER_MARKS.some((m) => name.includes(m))
}
