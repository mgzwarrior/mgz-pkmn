/**
 * itemsToExportRows — adapt collection / want-list items into the `Row` shape
 * the export endpoint and {@link ExportBar} consume (#773).
 *
 * A saved item carries the verbatim card payload (`card`) plus promoted
 * identity/price columns. Export treats one card copy as one matched row — the
 * same contract a Search result row uses — so the detail views can offer the
 * same xlsx / PDF / checklist exports as Search. A collection item's owned
 * `quantity` expands into that many rows so exports (and their price totals /
 * binder slots) match the detail view; want-list items carry no quantity and
 * stay one row each.
 */
import type { CardData, Row } from '../types'

interface ExportableItem {
  card: Record<string, unknown>
  card_name?: string | null
  card_number?: string | null
  card_set_id?: string | null
  price_snapshot?: number | null
  quantity?: number | null
}

export function itemsToExportRows(items: ExportableItem[]): Row[] {
  return items.flatMap((it) => {
    const row: Row = {
      query: {
        raw: it.card_name ?? '',
        name: it.card_name ?? '',
        set_hint: it.card_set_id ?? null,
        number: it.card_number ?? null,
        variant_hint: null,
        url_hint: null,
        bulk_top: null,
        bulk_all: false,
        price_min: null,
        price_max: null,
      },
      // The stored payload is the verbatim card JSON — exactly what export reads.
      card: it.card as unknown as CardData,
      pricing: {
        market: it.price_snapshot ?? null,
        variant: null,
        source: null,
        url: null,
        currency: 'USD',
      },
      tag: '',
      matched: true,
      reason: '',
    }
    // One row per owned copy (floored at 1), so a quantity-3 card exports as
    // three rows / slots and its price counts thrice — matching the detail view.
    const copies = Math.max(1, it.quantity ?? 1)
    return Array.from({ length: copies }, () => ({ ...row }))
  })
}
