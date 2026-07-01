/**
 * ResultCard — one lookup row rendered as a card for mobile viewports (#521).
 *
 * The desktop `ResultsTable` row packs seven columns that never fit a phone,
 * so below the `lg` breakpoint each row collapses to a card instead: the same
 * thumbnail / name / set / rarity / market price / one comp tier / source the
 * row shows, plus the same save-to-collection, add-to-wishlist, and
 * view-detail actions. Visual language borrows from the Swipe-mode card
 * (rounded artwork tile with an `ImageOff` fallback, the same name/set/rarity
 * meta line) so the two surfaces read as the same product.
 */
import { useState } from 'react'
import { AlertCircle, ExternalLink, ImageOff } from 'lucide-react'
import { addOverride } from '../api/client'
import type { CardOwnership } from '../api/client'
import { useAppStore } from '../store'
import type { Row } from '../types'
import { formatComp, formatMoney } from '../utils/format'
import { AffiliateLinks } from './AffiliateLinks'
import { OwnershipBadge } from './OwnershipBadge'
import { SaveCardActions } from './SaveCardActions'

interface Props {
  row: Row
  showImage: boolean
  showSavedActions: boolean
  ownership: CardOwnership | null | undefined
  onRerunLine?: (line: string) => void
  onOpenDetail?: () => void
}

export function ResultCard({
  row,
  showImage,
  showSavedActions,
  ownership,
  onRerunLine,
  onOpenDetail,
}: Props) {
  const card = row.card
  const p = row.pricing
  const [showOverrideForm, setShowOverrideForm] = useState(false)
  const [overrideUrl, setOverrideUrl] = useState('')
  const [overrideSaving, setOverrideSaving] = useState(false)

  const imgUrl = card?.images?.small as string | undefined
  const setName = (card?.set as { name?: string } | undefined)?.name
  const isOverCap =
    useAppStore.getState().settings.maxPrice != null &&
    p.market != null &&
    p.market > (useAppStore.getState().settings.maxPrice ?? Infinity)

  async function handleSaveOverride() {
    if (!overrideUrl.trim()) return
    setOverrideSaving(true)
    try {
      await addOverride(row.query.name, row.query.set_hint, overrideUrl.trim())
      setShowOverrideForm(false)
      setOverrideUrl('')
      if (onRerunLine) onRerunLine(row.query.raw)
    } finally {
      setOverrideSaving(false)
    }
  }

  const canOpenDetail = row.matched && !!onOpenDetail
  function handleCardClick(e: React.MouseEvent<HTMLLIElement>) {
    if (!canOpenDetail) return
    // Skip clicks on inner interactive elements, same as the table row —
    // otherwise tapping a buy link or quick action would also open the modal.
    const target = e.target as HTMLElement
    if (target.closest('a, button, input')) return
    onOpenDetail!()
  }

  return (
    <li
      className={`rounded-lg border border-sand-300 bg-sand-50 p-3 dark:border-husk-50 dark:bg-husk-200 ${
        !row.matched ? 'opacity-60' : ''
      } ${isOverCap ? 'bg-sun-100 dark:bg-sun-400/15' : ''} ${canOpenDetail ? 'cursor-pointer' : ''}`}
      onClick={canOpenDetail ? handleCardClick : undefined}
      tabIndex={canOpenDetail ? 0 : undefined}
      onKeyDown={
        canOpenDetail
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              const target = e.target as HTMLElement
              if (target.closest('a, button, input')) return
              e.preventDefault()
              onOpenDetail!()
            }
          : undefined
      }
      aria-label={
        canOpenDetail ? `View details for ${(card?.name as string) ?? row.query.name}` : undefined
      }
    >
      <div className="flex gap-3">
        {showImage && (
          <div className="relative aspect-[245/342] w-16 flex-shrink-0 overflow-hidden rounded-md bg-sand-200 dark:bg-husk-100">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={card?.name as string}
                className="h-full w-full object-contain"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-coconut-300 dark:text-sand-400">
                <ImageOff size={20} aria-hidden />
              </div>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {row.matched ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <div className="truncate font-medium text-coconut-700 dark:text-sand-50">
                  {card?.name as string}
                </div>
                <span
                  className={`shrink-0 font-mono text-sm tabular-nums ${
                    isOverCap
                      ? 'font-bold text-sun-600 dark:text-sun-300'
                      : p.market
                        ? 'text-palm-500 dark:text-palm-200'
                        : 'text-coconut-400 dark:text-sand-300'
                  }`}
                >
                  {formatMoney(p.market, p.currency)}
                </span>
              </div>
              <div className="truncate text-xs text-coconut-400 dark:text-sand-300">
                {setName ?? '—'}
                {card?.number ? ` · #${card.number as string}` : ''}
                {card?.rarity ? ` · ${card.rarity as string}` : ''}
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-coconut-400 dark:text-sand-300">
                <span>{p.source ?? '—'}</span>
                <span className="font-mono tabular-nums">{formatComp(p.market, 85, p.currency)} · 85%</span>
              </div>
              <OwnershipBadge ownership={ownership} className="mt-1" />
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 text-coconut-400 dark:text-sand-300">
                <AlertCircle size={13} className="flex-shrink-0 text-sun-600 dark:text-sun-300" />
                <span className="truncate">{row.query.raw}</span>
              </div>
              <button
                onClick={() => setShowOverrideForm((v) => !v)}
                className="mt-0.5 text-xs text-palm-500 hover:text-palm-400 hover:underline dark:text-sun-300 dark:hover:text-sun-200"
              >
                + Add PriceCharting URL
              </button>
            </>
          )}
        </div>
      </div>

      {row.matched && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-sand-200 pt-2 dark:border-husk-100">
          <SaveCardActions card={card as Record<string, unknown>} ownership={ownership} show={showSavedActions} />
          <div className="flex items-center gap-2">
            {p.url && (
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-coconut-400 transition-colors hover:text-palm-500 dark:text-sand-300 dark:hover:text-sun-300"
                title="Open listing"
              >
                <ExternalLink size={13} />
              </a>
            )}
            <AffiliateLinks card={card} />
          </div>
        </div>
      )}

      {showOverrideForm && (
        <div className="mt-2 flex items-center gap-2 border-t border-sand-200 pt-2 dark:border-husk-100">
          <input
            type="url"
            value={overrideUrl}
            onChange={(e) => setOverrideUrl(e.target.value)}
            placeholder="https://www.pricecharting.com/game/pokemon-…"
            className="flex-1 rounded border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-200 dark:text-sand-50 dark:placeholder:text-sand-500 dark:focus:ring-sun-300"
            onKeyDown={(e) => e.key === 'Enter' && handleSaveOverride()}
          />
          <button
            onClick={handleSaveOverride}
            disabled={overrideSaving || !overrideUrl.trim()}
            className="rounded bg-sun-300 px-2 py-1 text-xs font-medium text-coconut-700 transition-colors hover:bg-sun-400 disabled:opacity-50 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200"
          >
            {overrideSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </li>
  )
}
