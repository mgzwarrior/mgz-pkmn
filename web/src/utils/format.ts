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
 * value if the clock briefly drifts backwards. Values that would
 * round to exactly `60.00s` (e.g. 59_995 ms) roll over to `1m00s` so
 * the sub-minute branch never displays the next minute's boundary.
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = ms / 1000
  if (seconds < 60) {
    // `toFixed(2)` can round just-under-60 values up to "60.00"
    // (e.g. 59.999s). Promote that case to the next minute so the
    // sub-minute branch never displays the boundary value.
    const display = seconds.toFixed(2)
    if (parseFloat(display) < 60) return `${display}s`
    return '1m00s'
  }
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}m${s.toString().padStart(2, '0')}s`
}
