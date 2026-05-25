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
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'
import { useEffect } from 'react'
import type { CardData, Row } from '../types'

interface Props {
  /** The already filtered + sorted row set the parent table is showing. */
  rows: Row[]
  /** Index into `rows` for the card currently in view; `null` = modal closed. */
  index: number | null
  /** Set to `null` to close, or to a new index to navigate. */
  onChangeIndex: (next: number | null) => void
}

export function CardDetailModal({ rows, index, onChangeIndex }: Props) {
  const isOpen = index !== null && index >= 0 && index < rows.length
  const row = isOpen ? rows[index] : null

  // ←/→ keyboard navigation. Bound to window so the listener works whether
  // focus is on the dialog frame, the image, or inside one of the metadata
  // panels — Radix's own focus trap keeps Tab inside the dialog, but arrow
  // keys still need their own handler.
  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) {
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
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
          {row ? (
            <CardDetailBody
              row={row}
              index={index!}
              total={rows.length}
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
  onPrev,
  onNext,
}: {
  row: Row
  index: number
  total: number
  onPrev?: () => void
  onNext?: () => void
}) {
  const card = row.card
  const pricing = row.pricing
  const imgUrl =
    (card?.images?.large as string | undefined) ??
    (card?.images?.small as string | undefined)
  const sourceUrl = deriveSourceUrl(row)

  const setObj = (card?.set ?? {}) as Record<string, unknown>
  const setName = setObj.name as string | undefined
  const setSeries = setObj.series as string | undefined
  const cardNumber = card?.number as string | undefined
  const rarity = card?.rarity as string | undefined
  const variant = pricing.variant ?? row.query.variant_hint

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-3">
        <div className="flex items-center gap-2">
          <Dialog.Title className="text-base font-semibold text-zinc-100">
            {(card?.name as string | undefined) ?? row.query.name}
          </Dialog.Title>
          <span className="text-xs text-zinc-500 font-mono tabular-nums">
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
              className="rounded p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
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
        className="flex-1 overflow-y-auto px-5 py-4 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          {/* Image column */}
          <div className="flex justify-center md:justify-start">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={(card?.name as string | undefined) ?? row.query.name}
                className="rounded-md shadow-lg max-h-[420px] w-auto object-contain bg-zinc-800"
                loading="lazy"
              />
            ) : (
              <div className="flex h-[360px] w-[260px] items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-500">
                No image available
              </div>
            )}
          </div>

          {/* Identity + pricing two-column */}
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
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
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  Pricing
                </h3>
                <div className="rounded-md border border-zinc-700 bg-zinc-950 p-3 space-y-1">
                  <PriceLine
                    label="Market"
                    value={fmt(pricing.market, pricing.currency)}
                    bold
                    highlight
                  />
                  <PriceLine
                    label="95%"
                    value={comp(pricing.market, 95, pricing.currency)}
                  />
                  <PriceLine
                    label="90%"
                    value={comp(pricing.market, 90, pricing.currency)}
                  />
                  <PriceLine
                    label="85%"
                    value={comp(pricing.market, 85, pricing.currency)}
                  />
                  <PriceLine
                    label="80%"
                    value={comp(pricing.market, 80, pricing.currency)}
                  />
                </div>
                {pricing.source && (
                  <p className="mt-2 text-xs text-zinc-400">
                    Source: <span className="text-zinc-300">{pricing.source}</span>
                  </p>
                )}
                {sourceUrl && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300"
                  >
                    View on {sourceLabel(row)}{' '}
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>

            <CardMetadataBlock card={card} />
          </div>
        </div>
      </div>
    </>
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
      <p className="text-xs text-zinc-500">
        No additional card data was returned by the source.
      </p>
    )
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
        Card data
      </h3>
      <div className="rounded-md border border-zinc-700 bg-zinc-950 p-4 space-y-3 text-sm">
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
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
              Attacks
            </div>
            <ul className="space-y-2">
              {attacks.map((a, i) => (
                <li
                  key={i}
                  className="rounded border border-zinc-800 bg-zinc-900 p-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-zinc-100">{a.name}</span>
                    {a.damage && (
                      <span className="font-mono text-zinc-300">{a.damage}</span>
                    )}
                  </div>
                  {a.cost && a.cost.length > 0 && (
                    <div className="text-xs text-zinc-400 mt-0.5">
                      Cost: {a.cost.join(' · ')}
                    </div>
                  )}
                  {a.text && (
                    <p className="text-xs text-zinc-400 mt-1 leading-snug">
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
            <span className="italic text-zinc-300">{flavorText}</span>
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
      className="rounded p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function DefinitionList({ rows }: { rows: [string, string | null][] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
        Identity
      </h3>
      <dl className="space-y-1.5 text-sm">
        {rows
          .filter(([, value]) => value != null && value !== '')
          .map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="text-zinc-500 min-w-[64px]">{label}</dt>
              <dd className="text-zinc-200">{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-xs uppercase tracking-wider text-zinc-500 min-w-[80px] mt-0.5">
        {label}
      </span>
      <span className="flex-1 text-zinc-200">{children}</span>
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
      <span className="text-xs text-zinc-400">{label}</span>
      <span
        className={`font-mono tabular-nums ${bold ? 'font-bold text-base' : 'text-sm'} ${
          highlight ? 'text-green-400' : 'text-zinc-200'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function fmt(amount: number | null, currency = 'USD'): string {
  if (amount == null) return '—'
  const sym = currency === 'EUR' ? '€' : '$'
  return `${sym}${amount.toFixed(2)}`
}

function comp(market: number | null, pct: number, currency = 'USD'): string {
  if (market == null) return '—'
  return fmt((market * pct) / 100, currency)
}

function sourceLabel(row: Row): string {
  const db = row.card?._database as string | undefined
  if (db) return db
  if (row.pricing.source) return row.pricing.source
  return 'source'
}

/**
 * Best available link out to the card's canonical source page. Preference order:
 * 1. `pricing.url` — already set by the lookup when there's a real listing
 *    (PriceCharting, TCGPlayer, Cardmarket).
 * 2. `card.tcgplayer.url` / `card.cardmarket.url` — pokemontcg.io carries
 *    these on every card it knows.
 * 3. A pokemontcg.io card-page URL derived from `card.id`.
 * Returns null when nothing usable is available — the link is then hidden.
 */
function deriveSourceUrl(row: Row): string | null {
  if (row.pricing.url) return row.pricing.url
  const card = row.card
  if (!card) return null
  const tcgplayer = card.tcgplayer as { url?: string } | undefined
  if (tcgplayer?.url) return tcgplayer.url
  const cardmarket = card.cardmarket as { url?: string } | undefined
  if (cardmarket?.url) return cardmarket.url
  if (card.id) {
    // pokemontcg.io card IDs are stable; the public web app uses this shape.
    return `https://pokemontcg.io/cards/${card.id}`
  }
  return null
}
