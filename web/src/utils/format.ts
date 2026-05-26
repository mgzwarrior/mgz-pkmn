/**
 * Shared money / comp formatters.
 *
 * Both `ResultsTable` and `CardDetailModal` render market price and the
 * 80/85/90/95 % comp tiers; this module is the single source of truth so
 * the two surfaces never drift on currency symbols, rounding, or the
 * em-dash sentinel for missing prices.
 */

/** Format a monetary amount with the source's currency symbol. */
export function formatMoney(amount: number | null, currency = 'USD'): string {
  if (amount == null) return '—'
  const sym = currency === 'EUR' ? '€' : '$'
  return `${sym}${amount.toFixed(2)}`
}

/** Format a percentage-of-market comp tier (e.g. 80, 85, 90, 95). */
export function formatComp(
  market: number | null,
  pct: number,
  currency = 'USD',
): string {
  if (market == null) return '—'
  return formatMoney((market * pct) / 100, currency)
}
