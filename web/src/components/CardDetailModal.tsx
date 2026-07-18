/**
 * CardDetailModal — opens when a row in `ResultsTable` is clicked.
 *
 * Renders the large card image, a two-column header (identity + pricing),
 * and a "card data" block that surfaces whatever optional fields the
 * source returned (subtype, HP, attacks, weaknesses, retreat, regulation
 * mark, artist, dex number, flavor text). Missing fields are silently
 * skipped — the layout has to stay clean across every source's schema.
 *
 * Keyboard:
 *   - ←/→ — step through the parent's (already filtered + sorted) rows
 *   - Esc — close (handled by Radix Dialog)
 *
 * The dialog role, focus trap, and aria wiring all come from
 * `@radix-ui/react-dialog` — matches the existing HelpModal / SetPickerModal
 * patterns so we don't duplicate a11y plumbing.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Minus, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  removeCardFromCollection,
  removeCardFromWishlist,
  updateCollectionItemByCard,
  type CardOwnership,
} from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import type { CardCondition, CardData, CardSet, EbaySoldComp, Pricing, Row } from '../types'
import { ebayAffiliateUrl, tcgplayerAffiliateUrl } from '../utils/affiliateLinks'
import {
  conditionPricingForRow,
  rowConditionKey,
} from '../utils/conditionPricing'
import { formatComp, formatMoney } from '../utils/format'
import { AffiliateLinks } from './AffiliateLinks'
import {
  cardCategories,
  CATEGORY_LABELS,
  CATEGORY_REFERENCES,
} from './cardCategories'
import { EbaySparkline } from './EbaySparkline'
import { hasEbayData, soldPriceSeries } from './ebayComps'
import { AddToListPicker } from './AddToListPicker'
import { ConditionOverrideSelect } from './ConditionOverrideSelect'
import { OwnershipBadge } from './OwnershipBadge'
import { SaveCardActions } from './SaveCardActions'
import { invalidateOwnership, useCardOwnership } from './useCardOwnership'
import { useCollections } from './useCollections'
import { useWishlists } from './useWishlists'

interface Props {
  /** The already filtered + sorted row set the parent table is showing. */
  rows: Row[]
  /** Index into `rows` for the card currently in view; `null` = modal closed. */
  index: number | null
  /** Set to `null` to close, or to a new index to navigate. */
  onChangeIndex: (next: number | null) => void
  /**
   * Run as a Radix modal layer (focus trap + outside pointer lock). Defaults
   * to `true` for the normal in-table usage. The guided Tour opens its own
   * sample instance with `modal={false}` so the tour card's Next/Back/Skip
   * controls — rendered as siblings, not inside the dialog — stay clickable.
   */
  modal?: boolean
  onConditionOverrideChange?: (row: Row, condition: CardCondition | null) => void
}

function shouldIgnoreModalArrowKey(e: KeyboardEvent) {
  const target = e.target
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]') !== null
}

export function CardDetailModal({
  rows,
  index,
  onChangeIndex,
  modal = true,
  onConditionOverrideChange,
}: Props) {
  const isOpen = index !== null && index >= 0 && index < rows.length
  const row = isOpen ? rows[index] : null

  // Collection-aware actions + owned/chasing badges, gated on a signed-in
  // user (matching the result-row save column). Warm the ownership cache for
  // the whole row set the modal can page through, so ←/→ navigation is
  // instant; the lookup is keyed by (set id, number) like every other surface.
  const { user } = useAuth()
  const showActions = user !== null
  const ownershipIds = useMemo(
    () =>
      showActions
        ? rows
            .map((r) => ({
              setId: (r.card?.set as CardSet | undefined)?.id ?? '',
              number: (r.card?.number as string | undefined) ?? '',
            }))
            .filter((idt) => idt.setId && idt.number)
        : [],
    [rows, showActions],
  )
  const { lookup: lookupOwnership } = useCardOwnership(ownershipIds)

  const currentSetId = (row?.card?.set as CardSet | undefined)?.id
  const currentNumber = row?.card?.number as string | undefined
  const ownership: CardOwnership | null | undefined =
    showActions && currentSetId && currentNumber
      ? lookupOwnership(currentSetId, currentNumber)
      : null

  // Reset to null when the parent's row set shifts so the modal no longer
  // points at a valid entry — e.g. a filter is applied while the modal is
  // open, or a new lookup clears the list. Without this, `index` would
  // remain set (just out-of-bounds) and the modal would silently reopen
  // later if `rows.length` grew back past the stale index.
  useEffect(() => {
    if (index !== null && (index < 0 || index >= rows.length)) {
      onChangeIndex(null)
    }
  }, [index, rows.length, onChangeIndex])

  // ←/→ keyboard navigation. Bound to window so the listener works whether
  // focus is on the dialog frame, the image, or inside one of the metadata
  // panels — Radix's own focus trap keeps Tab inside the dialog, but arrow
  // keys still need their own handler.
  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) {
      if (shouldIgnoreModalArrowKey(e)) return
      if (e.key === 'ArrowLeft' && index! > 0) {
        e.preventDefault()
        onChangeIndex(index! - 1)
      } else if (e.key === 'ArrowRight' && index! < rows.length - 1) {
        e.preventDefault()
        onChangeIndex(index! + 1)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, index, rows.length, onChangeIndex])

  function handleOpenChange(next: boolean) {
    if (!next) onChangeIndex(null)
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange} modal={modal}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          data-tour="card-detail"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200 shadow-2xl"
        >
          {row ? (
            <CardDetailBody
              row={row}
              index={index!}
              total={rows.length}
              showActions={showActions}
              ownership={ownership}
              onConditionOverrideChange={onConditionOverrideChange}
              onPrev={
                index! > 0 ? () => onChangeIndex(index! - 1) : undefined
              }
              onNext={
                index! < rows.length - 1
                  ? () => onChangeIndex(index! + 1)
                  : undefined
              }
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------------------------------------------------------------------------
// Body — split out so the keyboard / open-change logic above stays readable.
// ---------------------------------------------------------------------------

function CardDetailBody({
  row,
  index,
  total,
  showActions,
  ownership,
  onConditionOverrideChange,
  onPrev,
  onNext,
}: {
  row: Row
  index: number
  total: number
  showActions: boolean
  ownership: CardOwnership | null | undefined
  onConditionOverrideChange?: (row: Row, condition: CardCondition | null) => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const card = row.card
  const pricing = row.pricing
  const settings = useAppStore((s) => s.settings)
  const rowConditionOverrides = useAppStore((s) => s.rowConditionOverrides)
  const setRowConditionOverride = useAppStore((s) => s.setRowConditionOverride)
  const hidePricing = settings.hidePricing
  const conditionPricing = conditionPricingForRow(row, settings, rowConditionOverrides)
  const conditionOverride = rowConditionOverrides[rowConditionKey(row)] ?? null
  const imgUrl =
    (card?.images?.large as string | undefined) ??
    (card?.images?.small as string | undefined)
  const source = deriveSource(row)

  const setObj = (card?.set ?? {}) as Record<string, unknown>
  const setName = setObj.name as string | undefined
  const setSeries = setObj.series as string | undefined
  const cardNumber = card?.number as string | undefined
  const rarity = card?.rarity as string | undefined
  const variant = pricing.variant ?? row.query.variant_hint
  const conditionLabel = `Condition for ${(card?.name as string | undefined) ?? row.query.raw}`

  function handleConditionChange(condition: CardCondition | null) {
    if (onConditionOverrideChange) {
      onConditionOverrideChange(row, condition)
    } else {
      setRowConditionOverride(rowConditionKey(row), condition)
    }
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sand-300 dark:border-husk-50 px-5 py-3">
        <div className="flex items-center gap-2">
          <Dialog.Title className="text-base font-semibold text-coconut-700 dark:text-sand-50">
            {(card?.name as string | undefined) ?? row.query.name}
          </Dialog.Title>
          <span className="text-xs text-coconut-400 dark:text-sand-400 font-mono tabular-nums">
            {index + 1} / {total}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <NavButton
            label="Previous card"
            disabled={!onPrev}
            onClick={onPrev}
          >
            <ChevronLeft size={16} />
          </NavButton>
          <NavButton label="Next card" disabled={!onNext} onClick={onNext}>
            <ChevronRight size={16} />
          </NavButton>
          <Dialog.Close asChild>
            <button
              className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </Dialog.Close>
        </div>
      </div>

      {/* Body — scrollable */}
      <div
        tabIndex={0}
        className="flex-1 overflow-y-auto px-5 py-4 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
      >
        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          {/* Image column */}
          <div className="flex justify-center md:justify-start">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={(card?.name as string | undefined) ?? row.query.name}
                className="rounded-md shadow-lg max-h-[420px] w-auto object-contain bg-sand-200 dark:bg-husk-100"
                loading="lazy"
              />
            ) : (
              <div className="flex h-[360px] w-[260px] items-center justify-center rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 text-sm text-coconut-400 dark:text-sand-400">
                No image available
              </div>
            )}
          </div>

          {/* Identity + pricing two-column */}
          <div className="space-y-5">
            {/* Library actions — owned/chasing at a glance + save buttons.
                Signed-in + matched cards only; both pieces self-hide when
                there's nothing to show. */}
            {showActions && card && (
              <section
                aria-label="Library actions"
                data-tour="quick-actions"
                className="rounded-md border border-sand-300 bg-sand-50 p-3 shadow-sm dark:border-husk-50 dark:bg-husk-400"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
                    Library actions
                  </h3>
                  <OwnershipBadge ownership={ownership} />
                </div>
                <LibraryLocations ownership={ownership} card={card} />
                <SaveCardActions
                  card={card as unknown as Record<string, unknown>}
                  ownership={ownership}
                  show={showActions}
                  variant="primary"
                />
                {/* The light "organize later" step (#762): the toggles above
                    write to your default list; this drops the card onto a
                    specific named collection / want-list. */}
                <div className="mt-2 flex justify-end">
                  <AddToListPicker
                    card={card as unknown as Record<string, unknown>}
                    ownership={ownership}
                  />
                </div>
              </section>
            )}
            <CategoryBadges card={card} />
            <div className={`grid gap-4 ${hidePricing ? '' : 'sm:grid-cols-2'}`}>
              <DefinitionList
                rows={[
                  ['Name', (card?.name as string | undefined) ?? row.query.name],
                  ['Set', setName ?? '—'],
                  ['Series', setSeries ?? null],
                  ['Number', cardNumber ?? null],
                  ['Rarity', rarity ?? null],
                  ['Variant', variant ?? null],
                ]}
              />
              {!hidePricing && (
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
                      Pricing
                    </h3>
                    <ConditionOverrideSelect
                      label={conditionLabel}
                      value={conditionOverride}
                      defaultCondition={settings.condition ?? 'NM'}
                      onChange={handleConditionChange}
                    />
                  </div>
                  <div className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-400 p-3 space-y-1">
                    <PriceLine
                      label={`${conditionPricing.condition} market`}
                      value={formatMoney(conditionPricing.adjustedMarket, pricing.currency)}
                      bold
                      highlight
                    />
                    {conditionPricing.hasAdjustment && (
                      <PriceLine
                        label="NM market"
                        value={formatMoney(pricing.market, pricing.currency)}
                      />
                    )}
                    <PriceLine
                      label={`${conditionPricing.condition} 95%`}
                      value={formatComp(conditionPricing.adjustedMarket, 95, pricing.currency)}
                    />
                    <PriceLine
                      label={`${conditionPricing.condition} 90%`}
                      value={formatComp(conditionPricing.adjustedMarket, 90, pricing.currency)}
                    />
                    <PriceLine
                      label={`${conditionPricing.condition} 85%`}
                      value={formatComp(conditionPricing.adjustedMarket, 85, pricing.currency)}
                    />
                    <PriceLine
                      label={`${conditionPricing.condition} 80%`}
                      value={formatComp(conditionPricing.adjustedMarket, 80, pricing.currency)}
                    />
                    {conditionPricing.hasAdjustment && (
                      <>
                        <PriceLine
                          label="NM 95%"
                          value={formatComp(pricing.market, 95, pricing.currency)}
                        />
                        <PriceLine
                          label="NM 90%"
                          value={formatComp(pricing.market, 90, pricing.currency)}
                        />
                        <PriceLine
                          label="NM 85%"
                          value={formatComp(pricing.market, 85, pricing.currency)}
                        />
                        <PriceLine
                          label="NM 80%"
                          value={formatComp(pricing.market, 80, pricing.currency)}
                        />
                      </>
                    )}
                  </div>
                  {pricing.source && (
                    <p className="mt-2 text-xs text-coconut-400 dark:text-sand-300">
                      Source: <span className="text-coconut-600 dark:text-sand-200">{pricing.source}</span>
                    </p>
                  )}
                  {source && (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-palm-500 dark:text-sun-300 hover:text-palm-400 dark:hover:text-sun-200"
                    >
                      View on {source.label} <ExternalLink size={11} />
                    </a>
                  )}
                  {/* eBay / TCGplayer buy links sit directly under the price —
                      the "go buy this" path next to what it costs (#699). */}
                  <BuyBlock card={card} />
                </div>
              )}
            </div>

            {!hidePricing && <EbayCompsBlock pricing={pricing} />}

            <CardMetadataBlock card={card} />
          </div>
        </div>
      </div>
    </>
  )
}

/** The lists a card sits in, with an inline remove on each chip and — for
 *  collections — a quantity stepper (#762). The "organize later" complement
 *  to {@link AddToListPicker}: adjust or drop the card off a specific
 *  collection / want-list right from the detail view. Both target the card
 *  identity (the occupancy has no item ids) and go through the cache-aware
 *  hooks so counts and the badge re-read. */
function LibraryLocations({
  ownership,
  card,
}: {
  ownership: CardOwnership | null | undefined
  card: CardData | null
}) {
  const collections = useCollections()
  const wishlists = useWishlists()
  const [removing, setRemoving] = useState<string | null>(null)
  // The collection whose quantity PATCH is in flight, if any — gates the
  // stepper the same way the collection-detail one does (#769), so a stale
  // response can't land after a newer click.
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const setId = (card?.set as CardSet | undefined)?.id
  const number = card?.number as string | undefined

  // A remove/quantity edit invalidates the shared ownership cache, which
  // reads back `undefined` for a beat while it refetches. Rendering nothing
  // in that gap would unmount the chip the user just clicked mid-interaction
  // — the focused button vanishes, focus falls back to the document, and
  // Radix's dialog reads that as a click outside and closes the whole modal.
  // Keeping the last-known occupancy on screen through the refetch (the same
  // "stay mounted" fix `InlineRenameTitle` uses) avoids that. Reseeding on a
  // card change is React's documented "reset on prop change" pattern, so a
  // stale chip from the previous card can't leak onto the new one.
  const identityKey = setId && number ? `${setId}::${number}` : null
  const [syncedKey, setSyncedKey] = useState(identityKey)
  const [shown, setShown] = useState(ownership)
  if (identityKey !== syncedKey) {
    setSyncedKey(identityKey)
    setShown(ownership)
  } else if (ownership !== undefined && ownership !== shown) {
    setShown(ownership)
  }

  if (!shown || !card) return null
  const { collections: cols, wishlists: wls } = shown
  if (cols.length === 0 && wls.length === 0) return null

  async function remove(
    kind: 'collection' | 'wishlist',
    id: number,
    fn: () => Promise<void>,
  ) {
    if (!setId || !number) return
    setRemoving(`${kind}-${id}`)
    try {
      await fn()
      // Re-read the ownership badge / locations everywhere, and resync the
      // list counts the chip was removed from.
      invalidateOwnership()
      await (kind === 'collection' ? collections.refresh() : wishlists.refresh())
    } finally {
      setRemoving(null)
    }
  }

  async function changeQuantity(collectionId: number, currentQty: number, delta: number) {
    if (!setId || !number || currentQty + delta < 1 || updatingId === collectionId) return
    setUpdatingId(collectionId)
    try {
      await updateCollectionItemByCard(collectionId, setId, number, delta)
      invalidateOwnership()
      await collections.refresh()
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div
      aria-label="Library locations"
      className="mb-3 space-y-1.5 rounded-md bg-sand-100 px-2.5 py-2 text-xs text-coconut-500 dark:bg-husk-300 dark:text-sand-200"
    >
      {cols.length > 0 && (
        <LocationLine
          label="In:"
          noun="collection"
          chips={cols.map((c) => ({
            id: c.id,
            name: c.name,
            display: c.name,
            quantity: c.quantity,
          }))}
          removingKey={removing}
          keyPrefix="collection"
          onRemove={(id) =>
            void remove('collection', id, () =>
              removeCardFromCollection(id, setId as string, number as string),
            )
          }
          quantityBusyId={updatingId}
          onChangeQuantity={changeQuantity}
        />
      )}
      {wls.length > 0 && (
        <LocationLine
          label="Want:"
          noun="wishlist"
          chips={wls.map((w) => ({ id: w.id, name: w.name, display: w.name }))}
          removingKey={removing}
          keyPrefix="wishlist"
          onRemove={(id) =>
            void remove('wishlist', id, () =>
              removeCardFromWishlist(id, setId as string, number as string),
            )
          }
        />
      )}
    </div>
  )
}

function LocationLine({
  label,
  noun,
  chips,
  removingKey,
  keyPrefix,
  onRemove,
  quantityBusyId,
  onChangeQuantity,
}: {
  label: string
  noun: string
  chips: { id: number; name: string; display: string; quantity?: number }[]
  removingKey: string | null
  keyPrefix: string
  onRemove: (id: number) => void
  quantityBusyId?: number | null
  onChangeQuantity?: (id: number, currentQty: number, delta: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-semibold text-coconut-600 dark:text-sand-100">{label}</span>
      {chips.map((chip) => {
        const busy = removingKey === `${keyPrefix}-${chip.id}`
        const qty = chip.quantity
        const qtyBusy = quantityBusyId === chip.id
        return (
          <span
            key={chip.id}
            className="inline-flex items-center gap-1 rounded-full bg-sand-200 py-0.5 pl-1.5 pr-1 text-coconut-600 dark:bg-husk-100 dark:text-sand-100"
          >
            {chip.display}
            {qty != null && onChangeQuantity && (
              <span className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={qty <= 1 || qtyBusy}
                  onClick={() => onChangeQuantity(chip.id, qty, -1)}
                  aria-label={`Decrease quantity in ${chip.name}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-sand-300 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-husk-200"
                >
                  <Minus size={9} />
                </button>
                <span
                  className="min-w-[1rem] text-center tabular-nums"
                  aria-label={`Quantity in ${chip.name}`}
                >
                  {qty}
                </span>
                <button
                  type="button"
                  disabled={qtyBusy}
                  onClick={() => onChangeQuantity(chip.id, qty, 1)}
                  aria-label={`Increase quantity in ${chip.name}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-sand-300 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-husk-200"
                >
                  <Plus size={9} />
                </button>
              </span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemove(chip.id)}
              aria-label={`Remove from ${noun} ${chip.name}`}
              className="rounded-full p-0.5 text-coconut-400 hover:bg-sand-300 hover:text-ember-500 disabled:opacity-50 dark:text-sand-300 dark:hover:bg-husk-200 dark:hover:text-ember-300"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
            </button>
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CategoryBadges — collector archetype chips derived client-side from the
// card's name / rarity / subtypes / id (#700). Art-driven categories carry a
// "learn more" link out to the canonical reference. Self-hides when a card
// belongs to no category, so a plain common leaves no empty row behind.
// ---------------------------------------------------------------------------

function CategoryBadges({ card }: { card: CardData | null }) {
  if (!card) return null
  const categories = cardCategories({
    id: card.id as string | undefined,
    name: card.name as string | undefined,
    rarity: card.rarity as string | undefined,
    supertype: card.supertype as string | undefined,
    subtypes: card.subtypes as string[] | undefined,
  })
  if (categories.length === 0) return null

  const chip =
    'inline-flex items-center gap-1 rounded-full border border-palm-400 dark:border-sun-400 bg-sun-400/15 dark:bg-sun-400/30 px-2 py-0.5 text-[11px] font-medium text-palm-700 dark:text-sun-100'

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Card categories">
      {categories.map((category) => {
        const ref = CATEGORY_REFERENCES[category]
        return ref ? (
          <a
            key={category}
            href={ref.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Learn more — ${ref.label}`}
            className={`${chip} transition-colors hover:bg-sun-400/30 dark:hover:bg-sun-400/40`}
          >
            {CATEGORY_LABELS[category]}
            <ExternalLink size={9} aria-hidden />
          </a>
        ) : (
          <span key={category} className={chip}>
            {CATEGORY_LABELS[category]}
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BuyBlock — eBay + TCGPlayer affiliate search links for the card (#657).
// Omitted entirely when the card has no name to search on, so a sparse or
// unmatched card doesn't leave an empty "Buy" heading behind.
// ---------------------------------------------------------------------------

function BuyBlock({ card }: { card: CardData | null }) {
  const links = <AffiliateLinks card={card} variant="pill" />
  // AffiliateLinks renders null when there's nothing to link to; mirror that
  // so the heading never shows up alone.
  if (!ebayAffiliateUrl(card) && !tcgplayerAffiliateUrl(card)) return null

  return (
    <div className="mt-3 border-t border-sand-200 dark:border-husk-100 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300 mb-2">
        Buy
      </h3>
      {links}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EbayCompsBlock — median sold + active floor, a sparkline, and the raw
// recent sold comps (date · condition · price). Shown only when the eBay
// source contributed (epic #416); otherwise the section is omitted so the
// popup stays clean for cards with no eBay data.
// ---------------------------------------------------------------------------

function EbayCompsBlock({ pricing }: { pricing: Pricing }) {
  if (!hasEbayData(pricing)) return null
  const comps = pricing.ebay_sold_comps ?? []

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300 mb-2">
        eBay comps
      </h3>
      <div className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-400 p-3 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-1">
            <PriceLine
              label="Sold (median)"
              value={formatMoney(pricing.ebay_sold_median ?? null, pricing.currency)}
            />
            <PriceLine
              label="Active (floor)"
              value={formatMoney(pricing.ebay_active_floor ?? null, pricing.currency)}
            />
          </div>
          <EbaySparkline
            values={soldPriceSeries(pricing.ebay_sold_comps)}
            currency={pricing.currency}
            className="h-8 w-28 flex-shrink-0"
          />
        </div>

        {comps.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-coconut-400 dark:text-sand-400 text-left">
                <th className="font-medium py-1">Date</th>
                <th className="font-medium py-1">Condition</th>
                <th className="font-medium py-1 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((c, i) => (
                <EbayCompRow key={i} comp={c} currency={pricing.currency} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function EbayCompRow({ comp, currency }: { comp: EbaySoldComp; currency: string }) {
  const priceCell = (
    <span className="font-mono tabular-nums text-coconut-600 dark:text-sand-200">
      {formatMoney(comp.price, currency)}
    </span>
  )
  return (
    <tr className="border-t border-sand-200 dark:border-husk-100">
      <td className="py-1 text-coconut-600 dark:text-sand-200">{comp.date ?? '—'}</td>
      <td className="py-1 text-coconut-600 dark:text-sand-200">{comp.condition ?? '—'}</td>
      <td className="py-1 text-right">
        {comp.url ? (
          <a
            href={comp.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-palm-500 dark:text-sun-300 hover:text-palm-400 dark:hover:text-sun-200"
          >
            {priceCell}
          </a>
        ) : (
          priceCell
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// CardMetadataBlock — surfaces whatever optional fields the source returned.
// Every field is conditional so a sparse card (or one from a source that
// only fills a subset) doesn't leave a "label: undefined" hole in the UI.
// ---------------------------------------------------------------------------

function CardMetadataBlock({ card }: { card: CardData | null }) {
  if (!card) return null

  const supertype = card.supertype as string | undefined
  const subtypes = (card.subtypes as string[] | undefined) ?? []
  const hp = card.hp as string | undefined
  const types = (card.types as string[] | undefined) ?? []
  const evolvesFrom = card.evolvesFrom as string | undefined
  const attacks = (card.attacks as CardAttack[] | undefined) ?? []
  const weaknesses = (card.weaknesses as TypedValue[] | undefined) ?? []
  const resistances = (card.resistances as TypedValue[] | undefined) ?? []
  const retreatCost = (card.retreatCost as string[] | undefined) ?? []
  const regulationMark = card.regulationMark as string | undefined
  const artist = card.artist as string | undefined
  const nationalPokedexNumbers =
    (card.nationalPokedexNumbers as number[] | undefined) ?? []
  const flavorText = card.flavorText as string | undefined

  const hasAnyField =
    !!supertype ||
    subtypes.length > 0 ||
    !!hp ||
    types.length > 0 ||
    !!evolvesFrom ||
    attacks.length > 0 ||
    weaknesses.length > 0 ||
    resistances.length > 0 ||
    retreatCost.length > 0 ||
    !!regulationMark ||
    !!artist ||
    nationalPokedexNumbers.length > 0 ||
    !!flavorText

  if (!hasAnyField) {
    return (
      <p className="text-xs text-coconut-400 dark:text-sand-400">
        No additional card data was returned by the source.
      </p>
    )
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300 mb-2">
        Card data
      </h3>
      <div className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-400 p-4 space-y-3 text-sm">
        {(supertype || subtypes.length > 0) && (
          <Row label="Type">
            {[supertype, subtypes.join(' · ')].filter(Boolean).join(' — ')}
          </Row>
        )}
        {hp && <Row label="HP">{hp}</Row>}
        {types.length > 0 && <Row label="Energy">{types.join(' · ')}</Row>}
        {evolvesFrom && <Row label="Evolves from">{evolvesFrom}</Row>}

        {attacks.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider text-coconut-400 dark:text-sand-400 mb-1">
              Attacks
            </div>
            <ul className="space-y-2">
              {attacks.map((a, i) => (
                <li
                  key={i}
                  className="rounded border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200 p-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-coconut-700 dark:text-sand-50">{a.name}</span>
                    {a.damage && (
                      <span className="font-mono text-coconut-600 dark:text-sand-200">{a.damage}</span>
                    )}
                  </div>
                  {a.cost && a.cost.length > 0 && (
                    <div className="text-xs text-coconut-400 dark:text-sand-300 mt-0.5">
                      Cost: {a.cost.join(' · ')}
                    </div>
                  )}
                  {a.text && (
                    <p className="text-xs text-coconut-400 dark:text-sand-300 mt-1 leading-snug">
                      {a.text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {weaknesses.length > 0 && (
          <Row label="Weakness">
            {weaknesses.map((w) => `${w.type} ${w.value}`).join(', ')}
          </Row>
        )}
        {resistances.length > 0 && (
          <Row label="Resistance">
            {resistances.map((r) => `${r.type} ${r.value}`).join(', ')}
          </Row>
        )}
        {retreatCost.length > 0 && (
          <Row label="Retreat">{retreatCost.join(' · ')}</Row>
        )}
        {regulationMark && <Row label="Regulation">{regulationMark}</Row>}
        {artist && <Row label="Artist">{artist}</Row>}
        {nationalPokedexNumbers.length > 0 && (
          <Row label="Dex #">{nationalPokedexNumbers.join(', ')}</Row>
        )}
        {flavorText && (
          <Row label="Flavor">
            <span className="italic text-coconut-600 dark:text-sand-200">{flavorText}</span>
          </Row>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CardAttack {
  name: string
  cost?: string[]
  damage?: string
  text?: string
}

interface TypedValue {
  type: string
  value: string
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function DefinitionList({ rows }: { rows: [string, string | null][] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300 mb-2">
        Identity
      </h3>
      <dl className="space-y-1.5 text-sm">
        {rows
          .filter(([, value]) => value != null && value !== '')
          .map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="text-coconut-400 dark:text-sand-400 min-w-[64px]">{label}</dt>
              <dd className="text-coconut-600 dark:text-sand-200">{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-xs uppercase tracking-wider text-coconut-400 dark:text-sand-400 min-w-[80px] mt-0.5">
        {label}
      </span>
      <span className="flex-1 text-coconut-600 dark:text-sand-200">{children}</span>
    </div>
  )
}

function PriceLine({
  label,
  value,
  bold = false,
  highlight = false,
}: {
  label: string
  value: string
  bold?: boolean
  highlight?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-coconut-400 dark:text-sand-300">{label}</span>
      <span
        className={`font-mono tabular-nums ${bold ? 'font-bold text-base' : 'text-sm'} ${
          highlight ? 'text-palm-500 dark:text-palm-200' : 'text-coconut-600 dark:text-sand-200'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Best available link out to the card's canonical source page, paired
 * with a label that names the *same* site the URL points at.
 *
 * Splitting the URL and the label across two helpers (as the earlier
 * version did) created a real bug: a card from pokemontcg.io often
 * carries a TCGPlayer listing URL on `pricing.url`, so the link would
 * say "View on pokemontcg.io" while pointing at tcgplayer.com. The
 * unified decision tree below guarantees label and URL agree.
 *
 * Preference order:
 *   1. `pricing.url` — already set by the lookup when there's a real
 *      listing. The label is inferred from the host so PriceCharting,
 *      TCGPlayer, and Cardmarket each get the right name even when
 *      `_database` is "pokemontcg.io".
 *   2. `card.tcgplayer.url` / `card.cardmarket.url` — pokemontcg.io
 *      carries these on cards it knows.
 *   3. A pokemontcg.io card-page URL derived from `card.id`.
 * Returns null when nothing usable is available — the link is hidden.
 */
function deriveSource(row: Row): { url: string; label: string } | null {
  if (row.pricing.url) {
    return { url: row.pricing.url, label: labelForUrl(row.pricing.url, row) }
  }
  const card = row.card
  if (!card) return null
  const tcgplayer = card.tcgplayer as { url?: string } | undefined
  if (tcgplayer?.url) {
    return { url: tcgplayer.url, label: 'TCGPlayer' }
  }
  const cardmarket = card.cardmarket as { url?: string } | undefined
  if (cardmarket?.url) {
    return { url: cardmarket.url, label: 'Cardmarket' }
  }
  if (card.id) {
    // pokemontcg.io card IDs are stable; the public web app uses this shape.
    return {
      url: `https://pokemontcg.io/cards/${card.id}`,
      label: 'pokemontcg.io',
    }
  }
  return null
}

/**
 * Infer a human label from a listing URL. Falls back to `pricing.source`
 * (set by the lookup pipeline based on the matched URL) and finally to
 * a generic word so the link still renders something readable.
 */
function labelForUrl(url: string, row: Row): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('tcgplayer')) return 'TCGPlayer'
    if (host.includes('cardmarket')) return 'Cardmarket'
    if (host.includes('pricecharting')) return 'PriceCharting'
    if (host.includes('pokemontcg')) return 'pokemontcg.io'
  } catch {
    // URL parsing can throw on malformed input — fall through to the
    // pricing.source label rather than crashing the modal.
  }
  return row.pricing.source ?? 'source'
}
