/**
 * useBrowseSelection — multi-select state for Browse's card grids (#913).
 *
 * Transient, view-local UI state (not server-synced), so it's a plain hook
 * rather than the module-cache pattern `useCollections`/`useWishlists` use.
 * Selection is keyed by `${set_id}::${number}` — the same identity key the
 * ownership cache uses — so toggling works uniformly across set / pokedex /
 * class grids without the caller needing to dedupe.
 */
import { useState } from 'react'
import type { CardData } from '../types'

function cardKey(card: CardData): string {
  return `${card.set?.id ?? ''}::${card.number}`
}

export interface BrowseSelection {
  selectMode: boolean
  toggleSelectMode: () => void
  selected: CardData[]
  isSelected: (card: CardData) => boolean
  toggle: (card: CardData) => void
  clear: () => void
}

export function useBrowseSelection(): BrowseSelection {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMap, setSelectedMap] = useState<Map<string, CardData>>(new Map())

  function toggleSelectMode() {
    setSelectMode((v) => !v)
    setSelectedMap(new Map())
  }

  function isSelected(card: CardData): boolean {
    return selectedMap.has(cardKey(card))
  }

  function toggle(card: CardData) {
    setSelectedMap((prev) => {
      const next = new Map(prev)
      const key = cardKey(card)
      if (next.has(key)) next.delete(key)
      else next.set(key, card)
      return next
    })
  }

  function clear() {
    setSelectedMap(new Map())
  }

  return {
    selectMode,
    toggleSelectMode,
    selected: [...selectedMap.values()],
    isSelected,
    toggle,
    clear,
  }
}
