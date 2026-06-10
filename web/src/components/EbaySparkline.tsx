/**
 * EbaySparkline — a tiny inline line chart of recent eBay sold prices (#425).
 *
 * Deliberately dependency-free: a single normalised `<polyline>` in an SVG
 * sized by its wrapper. Colour comes from `currentColor` so the caller sets
 * the design-system token via a Tailwind text-* class — no hardcoded hex.
 *
 * Accessibility: the SVG carries `role="img"` and an `aria-label` summarising
 * the trend (count + low/high), so screen readers get the gist without the
 * decorative path. Renders nothing for fewer than two points — a trend line
 * needs at least two.
 */

interface Props {
  /** Sold prices in chronological order (oldest → newest). */
  values: number[]
  /** Currency symbol context for the aria summary. */
  currency?: string
  className?: string
}

// viewBox units — the wrapper's Tailwind width/height does the real sizing;
// preserveAspectRatio="none" lets the curve stretch to fill it.
const VB_W = 100
const VB_H = 24
const PAD = 2

export function EbaySparkline({ values, currency = 'USD', className = '' }: Props) {
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = (VB_W - PAD * 2) / (values.length - 1)

  const points = values
    .map((v, i) => {
      const x = PAD + i * stepX
      // Invert Y: SVG origin is top-left, but higher price should sit higher.
      const y = PAD + (1 - (v - min) / range) * (VB_H - PAD * 2)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const sym = currency === 'EUR' ? '€' : '$'
  const ariaLabel = `Recent eBay sold prices: ${values.length} sales, low ${sym}${min.toFixed(2)}, high ${sym}${max.toFixed(2)}`

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className={`text-palm-500 dark:text-sun-300 ${className}`}
    >
      <polyline
        points={points}
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
