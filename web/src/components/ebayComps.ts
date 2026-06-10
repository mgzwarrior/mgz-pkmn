/**
 * eBay comp helpers shared by the results-table column and the card popup
 * (#425). Pure functions, unit-tested in ebayComps.test.ts.
 */
import type { EbaySoldComp } from '../types'

/**
 * Chronological (oldest → newest) sold prices for the sparkline.
 *
 * Comps arrive newest-first as the source returns them. When every comp
 * carries a parseable date we sort ascending by it; otherwise we just
 * reverse the as-given order so the most recent sale lands on the right of
 * the sparkline either way.
 */
export function soldPriceSeries(comps: EbaySoldComp[] | null | undefined): number[] {
  if (!comps || comps.length === 0) return []
  const allDated = comps.every((c) => c.date != null && !Number.isNaN(Date.parse(c.date)))
  if (allDated) {
    return [...comps]
      .sort((a, b) => Date.parse(a.date as string) - Date.parse(b.date as string))
      .map((c) => c.price)
  }
  return comps.map((c) => c.price).reverse()
}

/** True when a row carries any eBay signal worth surfacing. */
export function hasEbayData(p: {
  ebay_sold_median?: number | null
  ebay_active_floor?: number | null
  ebay_sold_comps?: EbaySoldComp[] | null
}): boolean {
  return (
    p.ebay_sold_median != null ||
    p.ebay_active_floor != null ||
    (p.ebay_sold_comps != null && p.ebay_sold_comps.length > 0)
  )
}
