/**
 * ResultsTable — displays streamed lookup rows.
 *
 * Each row shows: thumbnail (if available), name, set, rarity,
 * market price, comp tiers (80/85/90/95%), price source, and a link to
 * the listing. Unmatched rows show an amber "not found" badge.
 *
 * Headers for Name / Set / Rarity / Market / Source are click-to-sort
 * (asc → desc → off). A Filter toggle reveals a row of per-column
 * inputs — text match for strings, min/max for the Market column. The
 * column sort/filter is view-only; exports still honor the sort mode
 * in Settings.
 */
import { useCallback, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, AlertCircle, Filter } from 'lucide-react'
import { addOverride } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import type { ResultsFilters, Row } from '../types'
import { formatComp, formatMoney } from '../utils/format'
import { AddToCollectionButton } from './AddToCollectionButton'
import { AddToWishlistButton } from './AddToWishlistButton'
import { CardDetailModal } from './CardDetailModal'
import { SaveSearchButton } from './SaveSearchButton'
import {
  applyFilters,
  applySort,
  hasActiveFilters,
  type SortColumn,
  type SortDir,
} from './resultsTableFilter'

interface Props {
  onRerunLine?: (line: string) => void
}

export function ResultsTable({ onRerunLine }: Props) {
  const { rows, progress, isRunning, settings, viewState, setViewState, resetViewState } =
    useAppStore()
  const { sortColumn, sortDir, showFilters, filters } = viewState
  // Hoist the auth read here (not in ResultRow) so we don't fire one
  // `/me` request per row on mount. Pass the boolean down — the rows
  // care about "should I render save buttons" not "who is the user".
  const { user: authedUser } = useAuth()
  const showSavedActions = authedUser !== null
  // Index into `displayedRows` for the row whose detail modal is open;
  // `null` keeps the modal closed. Tracking the index (not the row) lets
  // ←/→ navigation in the modal stay synced with the live filter+sort.
  const [detailIndex, setDetailIndex] = useState<number | null>(null)

  const cycleSort = useCallback(
    (column: SortColumn) => {
      const current = useAppStore.getState().viewState
      if (current.sortColumn !== column) {
        setViewState({ ...current, sortColumn: column, sortDir: 'asc' })
      } else if (current.sortDir === 'asc') {
        setViewState({ ...current, sortDir: 'desc' })
      } else {
        setViewState({ ...current, sortColumn: null, sortDir: null })
      }
    },
    [setViewState],
  )

  const setFilterValue = useCallback(
    <K extends keyof ResultsFilters>(key: K, value: ResultsFilters[K]) => {
      const current = useAppStore.getState().viewState
      setViewState({ ...current, filters: { ...current.filters, [key]: value } })
    },
    [setViewState],
  )

  const toggleFilters = useCallback(() => {
    const current = useAppStore.getState().viewState
    setViewState({ ...current, showFilters: !current.showFilters })
  }, [setViewState])

  const displayedRows = useMemo(
    () => applySort(applyFilters(rows, filters), sortColumn, sortDir),
    [rows, filters, sortColumn, sortDir],
  )

  // Map each Row object to its insertion index so the React key stays
  // pinned to the same logical row across sort/filter. Without this,
  // re-ordering would move ResultRow's local override-form state onto
  // a different card.
  const rowKeys = useMemo(() => {
    const map = new WeakMap<(typeof rows)[number], number>()
    rows.forEach((r, i) => map.set(r, i))
    return map
  }, [rows])

  if (rows.length === 0 && !isRunning) {
    return (
      <div className="flex items-center justify-center rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200 py-16 text-coconut-400 dark:text-sand-300 text-sm">
        Results will appear here after you run a lookup.
      </div>
    )
  }

  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <div className="flex flex-col gap-2">
      {/* Progress bar */}
      {(isRunning || (progress && progress.done < progress.total)) && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-sand-200 dark:bg-husk-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-palm-400 dark:bg-sun-300 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          {progress && (
            <span className="text-xs text-coconut-400 dark:text-sand-300 tabular-nums whitespace-nowrap">
              {progress.done} / {progress.total}
            </span>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggleFilters}
          aria-pressed={showFilters}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
            showFilters
              ? 'border-palm-400 bg-palm-50 text-palm-700 dark:border-sun-300/60 dark:bg-sun-400/15 dark:text-sun-300'
              : 'border-sand-300 dark:border-husk-50 bg-sand-100 dark:bg-husk-200 text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100'
          }`}
        >
          <Filter size={12} />
          {showFilters ? 'Hide filters' : 'Filter'}
        </button>
        <div className="flex items-center gap-3">
          <SaveSearchButton />
          {(sortColumn || hasActiveFilters(filters)) && (
            <button
              type="button"
              onClick={resetViewState}
              className="text-xs text-coconut-400 dark:text-sand-300 hover:text-coconut-600 dark:hover:text-sand-200"
            >
              Clear sort &amp; filters
            </button>
          )}
          <p className="text-xs text-coconut-400 dark:text-sand-300 text-right">
            {displayedRows.filter((r) => r.matched).length} matched ·{' '}
            {displayedRows.filter((r) => !r.matched).length} unmatched ·{' '}
            {displayedRows.length} shown
            {displayedRows.length !== rows.length && (
              <span className="text-coconut-400 dark:text-sand-300"> (of {rows.length})</span>
            )}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-sand-300 dark:border-husk-50">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-sand-300 dark:border-husk-50 bg-sand-100 dark:bg-husk-200 text-left">
              {!settings.noImages && (
                <th className="px-3 py-2 text-xs font-medium text-coconut-400 dark:text-sand-300 w-16">Img</th>
              )}
              <SortableHeader
                label="Name"
                column="name"
                active={sortColumn}
                dir={sortDir}
                onClick={cycleSort}
              />
              <SortableHeader
                label="Set"
                column="set"
                active={sortColumn}
                dir={sortDir}
                onClick={cycleSort}
                className="hidden md:table-cell"
              />
              <SortableHeader
                label="Rarity"
                column="rarity"
                active={sortColumn}
                dir={sortDir}
                onClick={cycleSort}
                className="hidden lg:table-cell"
              />
              <SortableHeader
                label="Market"
                column="market"
                active={sortColumn}
                dir={sortDir}
                onClick={cycleSort}
                align="right"
              />
              <th className="px-3 py-2 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden xl:table-cell">80%</th>
              <th className="px-3 py-2 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden xl:table-cell">85%</th>
              <th className="px-3 py-2 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden xl:table-cell">90%</th>
              <th className="px-3 py-2 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden xl:table-cell">95%</th>
              <SortableHeader
                label="Source"
                column="source"
                active={sortColumn}
                dir={sortDir}
                onClick={cycleSort}
                className="hidden sm:table-cell"
              />
              <th className="px-3 py-2 text-xs font-medium text-coconut-400 dark:text-sand-300 w-8">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
            {showFilters && (
              <tr className="border-b border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200">
                {!settings.noImages && (
                  <th>
                    <span className="sr-only">Image (no filter)</span>
                  </th>
                )}
                <FilterCell>
                  <FilterInput
                    aria-label="Filter by name"
                    placeholder="contains…"
                    value={filters.name}
                    onChange={(v) => setFilterValue('name', v)}
                  />
                </FilterCell>
                <FilterCell className="hidden md:table-cell">
                  <FilterInput
                    aria-label="Filter by set"
                    placeholder="contains…"
                    value={filters.set}
                    onChange={(v) => setFilterValue('set', v)}
                  />
                </FilterCell>
                <FilterCell className="hidden lg:table-cell">
                  <FilterInput
                    aria-label="Filter by rarity"
                    placeholder="contains…"
                    value={filters.rarity}
                    onChange={(v) => setFilterValue('rarity', v)}
                  />
                </FilterCell>
                <FilterCell>
                  <div className="flex gap-1">
                    <FilterInput
                      aria-label="Min market price"
                      type="number"
                      placeholder="min"
                      value={filters.marketMin}
                      onChange={(v) => setFilterValue('marketMin', v)}
                    />
                    <FilterInput
                      aria-label="Max market price"
                      type="number"
                      placeholder="max"
                      value={filters.marketMax}
                      onChange={(v) => setFilterValue('marketMax', v)}
                    />
                  </div>
                </FilterCell>
                {/* Comp-tier columns have no filter — sr-only labels keep axe
                    happy without adding visible noise. */}
                <th className="hidden xl:table-cell">
                  <span className="sr-only">80% (no filter)</span>
                </th>
                <th className="hidden xl:table-cell">
                  <span className="sr-only">85% (no filter)</span>
                </th>
                <th className="hidden xl:table-cell">
                  <span className="sr-only">90% (no filter)</span>
                </th>
                <th className="hidden xl:table-cell">
                  <span className="sr-only">95% (no filter)</span>
                </th>
                <FilterCell className="hidden sm:table-cell">
                  <FilterInput
                    aria-label="Filter by source"
                    placeholder="contains…"
                    value={filters.source}
                    onChange={(v) => setFilterValue('source', v)}
                  />
                </FilterCell>
                <th>
                  <span className="sr-only">Actions (no filter)</span>
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {displayedRows.map((row, displayedIdx) => (
              <ResultRow
                key={rowKeys.get(row) ?? -1}
                row={row}
                showImage={!settings.noImages}
                showSavedActions={showSavedActions}
                onRerunLine={onRerunLine}
                onOpenDetail={() => setDetailIndex(displayedIdx)}
              />
            ))}
            {isRunning && (
              <tr>
                <td colSpan={12} className="py-2 px-3">
                  <div className="h-1 w-24 rounded animate-pulse bg-sand-200 dark:bg-husk-100" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CardDetailModal
        rows={displayedRows}
        index={detailIndex}
        onChangeIndex={setDetailIndex}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SortableHeader({
  label,
  column,
  active,
  dir,
  onClick,
  className = '',
  align = 'left',
}: {
  label: string
  column: SortColumn
  active: SortColumn | null
  dir: SortDir | null
  onClick: (c: SortColumn) => void
  className?: string
  align?: 'left' | 'right'
}) {
  const isActive = active === column
  const Icon = isActive ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th
      className={`px-3 py-2 text-xs font-medium ${align === 'right' ? 'text-right' : ''} ${className}`}
    >
      <button
        type="button"
        onClick={() => onClick(column)}
        className={`inline-flex items-center gap-1 ${
          isActive ? 'text-coconut-700 dark:text-sand-50' : 'text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50'
        }`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon size={11} className={isActive ? 'opacity-100' : 'opacity-40'} />
      </button>
    </th>
  )
}

function FilterCell({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <th className={`px-2 py-1.5 ${className}`}>{children}</th>
}

function FilterInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: 'text' | 'number'
  'aria-label': string
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-sand-300 dark:border-husk-50 bg-sand-100 dark:bg-husk-200 px-1.5 py-0.5 text-xs text-coconut-600 dark:text-sand-200 placeholder:text-coconut-300 dark:placeholder:text-sand-500 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:focus:ring-sun-300"
    />
  )
}

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------

function ResultRow({
  row,
  showImage,
  showSavedActions,
  onRerunLine,
  onOpenDetail,
}: {
  row: Row
  showImage: boolean
  showSavedActions: boolean
  onRerunLine?: (line: string) => void
  onOpenDetail?: () => void
}) {
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
      // Optionally re-run this line
      if (onRerunLine) onRerunLine(row.query.raw)
    } finally {
      setOverrideSaving(false)
    }
  }

  // Only matched rows open the detail modal. Unmatched rows have nothing
  // to show (no card data, no image) and already carry their own inline
  // affordance (the "+ Add PriceCharting URL" button).
  const canOpenDetail = row.matched && !!onOpenDetail
  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>) {
    if (!canOpenDetail) return
    // Skip clicks on inner interactive elements — links, buttons, inputs,
    // and the override-form panel below the row. Without this, clicking
    // the "open listing" external-link icon would *also* open the modal.
    const target = e.target as HTMLElement
    if (target.closest('a, button, input, [role="button"]')) return
    onOpenDetail!()
  }
  function handleRowKey(e: React.KeyboardEvent<HTMLTableRowElement>) {
    if (!canOpenDetail) return
    if (e.key === 'Enter' || e.key === ' ') {
      // Ignore activations that originated inside an inner control —
      // pressing Enter on the "open listing" anchor should follow the link.
      const target = e.target as HTMLElement
      if (target.closest('a, button, input')) return
      e.preventDefault()
      onOpenDetail!()
    }
  }

  return (
    <>
      <tr
        className={`border-b border-sand-200 dark:border-husk-100 hover:bg-sand-100 dark:hover:bg-husk-200/50 transition-colors motion-safe:animate-[fadeInRow_220ms_ease-out] ${
          !row.matched ? 'opacity-60' : ''
        } ${isOverCap ? 'bg-sun-100 dark:bg-sun-400/15' : ''} ${canOpenDetail ? 'cursor-pointer' : ''}`}
        onClick={canOpenDetail ? handleRowClick : undefined}
        onKeyDown={canOpenDetail ? handleRowKey : undefined}
        tabIndex={canOpenDetail ? 0 : undefined}
        aria-label={
          canOpenDetail
            ? `View details for ${(card?.name as string) ?? row.query.name}`
            : undefined
        }
      >
        {/* Thumbnail */}
        {showImage && (
          <td className="px-3 py-1.5 w-16">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={card?.name as string}
                className="w-10 h-14 object-contain rounded"
                loading="lazy"
              />
            ) : (
              <div className="w-10 h-14 rounded bg-sand-100 dark:bg-husk-200 flex items-center justify-center">
                <span className="text-coconut-400 dark:text-sand-300 text-xs">?</span>
              </div>
            )}
          </td>
        )}

        {/* Name */}
        <td className="px-3 py-2 max-w-[200px]">
          {row.matched ? (
            <div>
              <div className="font-medium text-coconut-700 dark:text-sand-50 truncate">{card?.name as string}</div>
              <div className="text-xs text-coconut-400 dark:text-sand-300 truncate">{row.query.raw}</div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1 text-coconut-400 dark:text-sand-300">
                <AlertCircle size={13} className="text-sun-600 dark:text-sun-300 flex-shrink-0" />
                <span className="truncate">{row.query.raw}</span>
              </div>
              <button
                onClick={() => setShowOverrideForm((v) => !v)}
                className="mt-0.5 text-xs text-palm-500 hover:text-palm-400 dark:text-sun-300 dark:hover:text-sun-200 hover:underline"
              >
                + Add PriceCharting URL
              </button>
            </div>
          )}
        </td>

        {/* Set */}
        <td className="px-3 py-2 text-coconut-400 dark:text-sand-300 text-xs hidden md:table-cell max-w-[160px]">
          <div className="truncate">{setName ?? '—'}</div>
          {card?.number && (
            <div className="text-coconut-400 dark:text-sand-300">#{card.number as string}</div>
          )}
        </td>

        {/* Rarity */}
        <td className="px-3 py-2 text-xs text-coconut-400 dark:text-sand-300 hidden lg:table-cell max-w-[120px] truncate">
          {(card?.rarity as string | undefined) ?? '—'}
        </td>

        {/* Market */}
        <td
          className={`px-3 py-2 text-right font-mono tabular-nums ${
            isOverCap ? 'text-sun-600 dark:text-sun-300 font-bold' : p.market ? 'text-palm-500 dark:text-palm-200' : 'text-coconut-400 dark:text-sand-300'
          }`}
        >
          {formatMoney(p.market, p.currency)}
        </td>

        {/* Comp tiers */}
        <td className="px-3 py-2 text-right font-mono tabular-nums text-coconut-400 dark:text-sand-300 text-xs hidden xl:table-cell">
          {formatComp(p.market, 80, p.currency)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-coconut-400 dark:text-sand-300 text-xs hidden xl:table-cell">
          {formatComp(p.market, 85, p.currency)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-coconut-400 dark:text-sand-300 text-xs hidden xl:table-cell">
          {formatComp(p.market, 90, p.currency)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-coconut-400 dark:text-sand-300 text-xs hidden xl:table-cell">
          {formatComp(p.market, 95, p.currency)}
        </td>

        {/* Price source */}
        <td className="px-3 py-2 text-xs text-coconut-400 dark:text-sand-300 hidden sm:table-cell">
          {p.source ?? '—'}
        </td>

        {/* Link + collection / wishlist actions */}
        <td className="px-3 py-2 w-20">
          <div className="flex items-center justify-end gap-1">
            {row.matched && card && showSavedActions && (
              <>
                <AddToCollectionButton card={card as Record<string, unknown>} />
                <AddToWishlistButton card={card as Record<string, unknown>} />
              </>
            )}
            {p.url && (
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-coconut-400 hover:text-palm-500 dark:text-sand-300 dark:hover:text-sun-300 transition-colors"
                title="Open listing"
              >
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </td>
      </tr>

      {/* Override URL form (inline, expands below row) */}
      {showOverrideForm && (
        <tr className="border-b border-sand-200 dark:border-husk-100 bg-sand-100 dark:bg-husk-200/60">
          <td colSpan={12} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={overrideUrl}
                onChange={(e) => setOverrideUrl(e.target.value)}
                placeholder="https://www.pricecharting.com/game/pokemon-…"
                className="flex-1 rounded border border-sand-300 dark:border-coconut-500 bg-sand-50 dark:bg-husk-200 px-2 py-1 text-xs text-coconut-700 dark:text-sand-50 placeholder:text-coconut-300 dark:placeholder:text-sand-500 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:focus:ring-sun-300"
                onKeyDown={(e) => e.key === 'Enter' && handleSaveOverride()}
              />
              <button
                onClick={handleSaveOverride}
                disabled={overrideSaving || !overrideUrl.trim()}
                className="rounded bg-sun-300 px-2 py-1 text-xs font-medium text-coconut-700 hover:bg-sun-400 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200 disabled:opacity-50 transition-colors"
              >
                {overrideSaving ? 'Saving…' : 'Save & re-run'}
              </button>
              <button
                onClick={() => setShowOverrideForm(false)}
                className="text-coconut-400 dark:text-sand-300 hover:text-coconut-600 dark:hover:text-sand-200 text-xs"
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
