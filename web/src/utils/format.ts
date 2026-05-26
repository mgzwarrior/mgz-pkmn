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

/**
 * Format an elapsed wall-clock duration in milliseconds as a compact
 * human-readable string: `123ms`, `1.24s`, or `1m02s`. Negative values
 * clamp to `0ms` so the running lookup timer never renders a negative
 * value if the clock briefly drifts backwards.
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(2)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}m${s.toString().padStart(2, '0')}s`
}
