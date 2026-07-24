import type { PricePoint } from '../types'

/**
 * PriceTrendSparkline — a tiny inline line chart of a card's 30-day price
 * history (#269), shown next to the market price on every matched results
 * row and enlarged in the card detail modal.
 *
 * Dependency-free like `EbaySparkline`: a single normalised `<polyline>` in
 * an SVG sized by its wrapper, coloured via `currentColor` so the caller
 * sets the design-system token via a Tailwind text-* class. Renders nothing
 * for fewer than two points — the API only returns `price_history` once at
 * least two distinct days of pricing exist (see `api/db/price_history.py`).
 *
 * Accessibility: the SVG carries `role="img"` plus an `aria-label` (screen
 * readers) and an equivalent `<title>` (native mouse-hover tooltip) naming
 * the trend direction and the window's low/high, per the issue's "hover
 * shows min/max/Δ" ask — no separate tooltip component needed.
 */

interface Props {
  points: PricePoint[] | null | undefined
  /** Currency symbol context for the summary. */
  currency?: string
  className?: string
}

// viewBox units — the wrapper's Tailwind width/height does the real sizing;
// preserveAspectRatio="none" lets the curve stretch to fill it.
const VB_W = 100
const VB_H = 24
const PAD = 2

export function PriceTrendSparkline({ points, currency = 'USD', className = '' }: Props) {
  if (!points || points.length < 2) return null

  const prices = points.map((p) => p.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const stepX = (VB_W - PAD * 2) / (prices.length - 1)

  const svgPoints = prices
    .map((v, i) => {
      const x = PAD + i * stepX
      // Invert Y: SVG origin is top-left, but higher price should sit higher.
      const y = PAD + (1 - (v - min) / range) * (VB_H - PAD * 2)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const sym = currency === 'EUR' ? '€' : '$'
  const delta = prices[prices.length - 1] - prices[0]
  const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const summary = `30-day price trend: ${trend} ${sym}${Math.abs(delta).toFixed(2)}, low ${sym}${min.toFixed(2)}, high ${sym}${max.toFixed(2)}`

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={summary}
      className={`text-palm-500 dark:text-sun-300 ${className}`}
    >
      <title>{summary}</title>
      <polyline
        points={svgPoints}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
