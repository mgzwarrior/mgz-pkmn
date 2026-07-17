/**
 * BrowseSelectionBar — floating multi-select toolbar for Browse's card
 * grids (#913). Mirrors {@link BulkActionBar}'s chrome (pill container,
 * divider-separated button groups, palm/sun tones) but scoped to what
 * Browse's selection needs: bulk `Own` / `Want` against the user's default
 * collection / wishlist (the same defaults the one-tap quick actions write
 * to, ADR-0027), and an undo for the last bulk action.
 *
 * Undo only reverses what this action actually changed — a card already
 * owned/wanted before the bulk action stays untouched, so re-running Own on
 * a mixed selection and then undoing never strips pre-existing ownership.
 */
import { Book, Footprints, Loader2, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import {
  hasPersonalOwnership,
  ownCard,
  unownCard,
  unwantCard,
  wantCard,
  type CardOwnership,
} from '../api/client'
import type { CardData } from '../types'
import { invalidateOwnership } from './useCardOwnership'
import { refreshCollectionsCache } from './useCollections'
import { refreshWishlistsCache } from './useWishlists'
import { QUICK_ACTION_TONES } from './quickActionTones'

interface LastAction {
  kind: 'own' | 'want'
  /** Only the cards this action actually newly added — undo reverses just
   *  these, leaving any already-owned/wanted card in the selection alone. */
  cards: CardData[]
}

export function BrowseSelectionBar({
  selected,
  lookupOwnership,
  onClear,
}: {
  selected: CardData[]
  lookupOwnership: (setId: string, number: string) => CardOwnership | null | undefined
  onClear: () => void
}) {
  const [busy, setBusy] = useState<'own' | 'want' | null>(null)
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const count = selected.length

  function ownershipOf(c: CardData): CardOwnership | null | undefined {
    return c.set?.id && c.number ? lookupOwnership(c.set.id, c.number) : null
  }

  // `undefined` means the batched ownership lookup for that card hasn't
  // resolved yet — acting now would treat an unknown card as "not owned/
  // wanted", write it anyway (harmless, idempotent), but then undo would
  // wrongly assume this action added it and strip pre-existing ownership.
  // Block the buttons until every selected card's ownership is known,
  // matching QuickActions' same loading guard (#767).
  const ownershipLoading = selected.some((c) => ownershipOf(c) === undefined)

  function unownedOf(cards: CardData[]): CardData[] {
    return cards.filter((c) => !hasPersonalOwnership(ownershipOf(c)))
  }

  function unwantedOf(cards: CardData[]): CardData[] {
    return cards.filter((c) => {
      const ownership = ownershipOf(c)
      return !ownership || ownership.wishlists.length === 0
    })
  }

  async function run(kind: 'own' | 'want') {
    setBusy(kind)
    setError(null)
    try {
      // Write exactly the cards undo will later reverse — a card already
      // owned/wanted is skipped rather than idempotently re-written, so the
      // write set and the undo set can never drift apart (#934 review).
      const toAdd = kind === 'own' ? unownedOf(selected) : unwantedOf(selected)
      const write = kind === 'own' ? ownCard : wantCard
      await Promise.all(toAdd.map((c) => write(c as unknown as Record<string, unknown>)))
      invalidateOwnership()
      await (kind === 'own' ? refreshCollectionsCache() : refreshWishlistsCache())
      setLastAction({ kind, cards: toAdd })
      onClear()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function undo() {
    if (!lastAction) return
    setBusy(lastAction.kind)
    setError(null)
    try {
      const undoFn = lastAction.kind === 'own' ? unownCard : unwantCard
      await Promise.all(
        lastAction.cards.map((c) => undoFn(c as unknown as Record<string, unknown>)),
      )
      invalidateOwnership()
      await (lastAction.kind === 'own' ? refreshCollectionsCache() : refreshWishlistsCache())
      setLastAction(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      role="region"
      aria-label="Browse selection actions"
      className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[95vw] flex-col items-center gap-1"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-full border border-sand-300 bg-sand-50/95 px-3 py-2 shadow-xl shadow-coconut-700/20 backdrop-blur dark:border-husk-50 dark:bg-husk-200/95">
        <span className="px-1 text-xs font-medium text-coconut-600 tabular-nums dark:text-sand-200">
          {count > 0 ? `${count} selected` : 'Tap cards to select'}
        </span>

        {count > 0 && (
          <>
            <SelectionButton
              label="Own"
              icon={Book}
              tone="palm"
              busy={busy === 'own'}
              disabled={busy !== null || ownershipLoading}
              onClick={() => void run('own')}
            />
            <SelectionButton
              label="Want"
              icon={Footprints}
              tone="sun"
              busy={busy === 'want'}
              disabled={busy !== null || ownershipLoading}
              onClick={() => void run('want')}
            />
          </>
        )}

        {lastAction && (
          <button
            type="button"
            onClick={() => void undo()}
            disabled={busy !== null}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-coconut-600 hover:bg-sand-200 disabled:opacity-40 dark:text-sand-200 dark:hover:bg-husk-100"
          >
            <RotateCcw size={13} />
            Undo
          </button>
        )}

        <span className="h-5 w-px bg-sand-300 dark:bg-husk-100" aria-hidden />

        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="rounded p-1 text-coconut-400 hover:bg-sand-200 hover:text-coconut-700 dark:text-sand-300 dark:hover:bg-husk-100 dark:hover:text-sand-50"
        >
          <X size={14} />
        </button>
      </div>
      {error && <span className="text-xs text-ember-500 dark:text-ember-300">{error}</span>}
    </div>
  )
}

function SelectionButton({
  label,
  icon: Icon,
  tone,
  busy,
  disabled,
  onClick,
}: {
  label: string
  icon: typeof Book
  tone: keyof typeof QUICK_ACTION_TONES
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label} selected cards`}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-40 ${QUICK_ACTION_TONES[tone].idle}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      {label}
    </button>
  )
}
