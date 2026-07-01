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
import { BulkActionBar } from './BulkActionBar'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import type { ResultsFilters, Row } from '../types'
import { formatComp, formatMoney } from '../utils/format'
import { QuickActions } from './QuickActions'
import { AffiliateLinks } from './AffiliateLinks'
import { CardDetailModal } from './CardDetailModal'
import { ResultsEmptyState } from './ResultsEmptyState'
import { useCardOwnership } from './useCardOwnership'
import { OwnershipBadge } from './OwnershipBadge'
import type { CardOwnership } from '../api/client'
import { EbaySparkline } from './EbaySparkline'
import { soldPriceSeries } from './ebayComps'
import { SaveSearchButton } from './SaveSearchButton'
import {
  applyFilters,
  applySort,
  hasActiveFilters,
  type SortColumn,
  type SortDir,
} from './resultsTableFilter'

/**
 * Pull the promoted `(set_id, number)` identity off a matched row for the
 * ownership lookup (#576). Returns null for unmatched rows or rows missing
 * either half of the identity.
 */
function rowIdentity(row: Row): { setId: string; number: string } | null {
  if (!row.matched || !row.card) return null
  const setId = (row.card.set as { id?: string } | undefined)?.id
  const number = row.card.number as string | undefined
  if (!setId || !number) return null
  return { setId, number }
}

/** Resolve a row's ownership through the shared lookup, or undefined. */
function ownershipForRow(
  row: Row,
  lookup: (setId: string, number: string) => CardOwnership | null | undefined,
): CardOwnership | null | undefined {
  const id = rowIdentity(row)
  return id ? lookup(id.setId, id.number) : undefined
}

/**
 * Whether a resolved ownership means the card sits in at least one collection
 * (#339). Wishlist-only occupancy ("chasing") doesn't count as owned — those
 * are exactly the cards the want-list view should keep. `undefined` (not yet
 * known) and `null` (no occupancy) are both not-owned, so a row stays visible
 * until its ownership resolves rather than flickering out mid-stream.
 */
function isOwned(ownership: CardOwnership | null | undefined): boolean {
  return ownership != null && ownership.collections.length > 0
}

interface Props {
  onRerunLine?: (line: string) => void
  /** Run an example query from the empty state (#523). */
  onRun?: (text: string) => void
  /** Switch to Browse mode from the empty state's "Walk a set" entry point. */
  onBrowse?: () => void
}

export function ResultsTable({ onRerunLine, onRun, onBrowse }: Props) {
  const { rows, setRows, progress, isRunning, settings, viewState, setViewState, resetViewState } =
    useAppStore()
  const { sortColumn, sortDir, showFilters, filters } = viewState
  // Hoist the auth read here (not in ResultRow) so we don't fire one
  // `/me` request per row on mount. Pass the boolean down — the rows
  // care about "should I render save buttons" not "who is the user".
  const auth = useAuth()
  const showSavedActions = auth.user !== null
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

  // Cross-collection ownership badges (#576). Batch the matched rows'
  // identities into one lookup; signed-out users get no library, so skip it.
  const ownershipIds = useMemo(
    () =>
      showSavedActions
        ? displayedRows
            .map(rowIdentity)
            .filter((id): id is { setId: string; number: string } => id !== null)
        : [],
    [showSavedActions, displayedRows],
  )
  const { lookup: lookupOwnership } = useCardOwnership(ownershipIds)

  // #339: when "hide owned" is on, drop matched rows already in one of the
  // user's collections, leaving just what's still missing. Owned-ness reuses
  // the badge's lookup, so no extra request. Signed-out users have no library,
  // so the toggle is inert for them.
  const hideOwned = settings.hideOwned && showSavedActions
  const visibleRows = useMemo(
    () =>
      hideOwned
        ? displayedRows.filter((row) => !isOwned(ownershipForRow(row, lookupOwnership)))
        : displayedRows,
    [hideOwned, displayedRows, lookupOwnership],
  )
  const hiddenOwnedCount = displayedRows.length - visibleRows.length

  // ---- Multi-select (#268) -------------------------------------------------
  // Selection is tracked by Row object reference: it rides along through
  // sort/filter re-ordering, and a fresh lookup (new Row objects) drops it
  // for free. Ephemeral by design — never persisted.
  const [selected, setSelected] = useState<Set<Row>>(() => new Set())
  // Index into `visibleRows` of the last toggled row, the anchor for a
  // shift-click range.
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null)
  // Power-user opt-in: keep the selection when the sort or filter changes.
  // Off by default so selection clears on any view change.
  const [preserveAcrossSort, setPreserveAcrossSort] = useState(false)
  // Snapshot of `rows` taken just before a bulk delete so Undo can restore it.
  const [undoSnapshot, setUndoSnapshot] = useState<Row[] | null>(null)

  // Selection intersected with the current view, in view order — this is
  // what the action bar operates on, so delete/retag/export all naturally
  // honor the active sort + filter.
  const selectedRows = useMemo(
    () => visibleRows.filter((r) => selected.has(r)),
    [visibleRows, selected],
  )

  // Clear the selection when the sort or filter changes (unless the
  // power-user "preserve across sort" toggle is on), and when a fresh
  // lookup starts. Done during render via React's "adjust state on a
  // change" pattern rather than an effect, so there's no extra commit.
  const viewSig = `${sortColumn}|${sortDir}|${JSON.stringify(filters)}`
  const [prevViewSig, setPrevViewSig] = useState(viewSig)
  if (viewSig !== prevViewSig) {
    setPrevViewSig(viewSig)
    if (!preserveAcrossSort && (selected.size > 0 || anchorIdx !== null)) {
      setSelected(new Set())
      setAnchorIdx(null)
    }
  }

  const [prevRunning, setPrevRunning] = useState(isRunning)
  if (isRunning !== prevRunning) {
    setPrevRunning(isRunning)
    // A fresh lookup just started — drop selection + undo from the old run.
    // (Keyed on the run, not rows.length, so deleting every row still leaves
    // Undo reachable.)
    if (isRunning) {
      if (selected.size > 0 || anchorIdx !== null) {
        setSelected(new Set())
        setAnchorIdx(null)
      }
      if (undoSnapshot !== null) setUndoSnapshot(null)
    }
  }

  const toggleRow = useCallback(
    (displayedIdx: number, shiftKey: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (shiftKey && anchorIdx !== null) {
          // Shift-click selects the whole range between the anchor and the
          // clicked row (inclusive).
          const lo = Math.min(anchorIdx, displayedIdx)
          const hi = Math.max(anchorIdx, displayedIdx)
          for (let i = lo; i <= hi; i++) next.add(visibleRows[i])
        } else {
          const row = visibleRows[displayedIdx]
          if (next.has(row)) next.delete(row)
          else next.add(row)
        }
        return next
      })
      setAnchorIdx(displayedIdx)
    },
    [visibleRows, anchorIdx],
  )

  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r))
  const someSelected = visibleRows.some((r) => selected.has(r))

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev)
      const everyVisibleSelected =
        visibleRows.length > 0 && visibleRows.every((r) => next.has(r))
      if (everyVisibleSelected) visibleRows.forEach((r) => next.delete(r))
      else visibleRows.forEach((r) => next.add(r))
      return next
    })
    setAnchorIdx(null)
  }, [visibleRows])

  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setAnchorIdx(null)
  }, [])

  // Delete the selected rows from the results view, snapshotting the prior
  // `rows` so Undo can put them back. Selection clears — the rows are gone.
  const handleDelete = useCallback(() => {
    const toRemove = selected
    if (toRemove.size === 0) return
    setUndoSnapshot(rows)
    setRows(rows.filter((r) => !toRemove.has(r)))
    setSelected(new Set())
    setAnchorIdx(null)
  }, [rows, selected, setRows])

  const handleUndo = useCallback(() => {
    if (!undoSnapshot) return
    setRows(undoSnapshot)
    setUndoSnapshot(null)
  }, [undoSnapshot, setRows])

  // Retag the selected rows in place, remapping the selection onto the new
  // Row objects so the bar's count stays put after the action.
  const handleRetag = useCallback(
    (tag: string) => {
      const sel = selected
      if (sel.size === 0) return
      const next = new Set<Row>()
      const newRows = rows.map((r) => {
        if (!sel.has(r)) return r
        const retagged = { ...r, tag }
        next.add(retagged)
        return retagged
      })
      setRows(newRows)
      setSelected(next)
    },
    [rows, selected, setRows],
  )

  if (rows.length === 0 && !isRunning) {
    return <ResultsEmptyState onRun={onRun} onBrowse={onBrowse} />
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
          {selectedRows.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-coconut-400 dark:text-sand-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={preserveAcrossSort}
                onChange={(e) => setPreserveAcrossSort(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-sand-300 text-palm-500 focus:ring-palm-400 dark:border-husk-50 dark:text-sun-300"
              />
              Keep selection across sort
            </label>
          )}
          <SaveSearchButton auth={auth} />
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
            {visibleRows.filter((r) => r.matched).length} matched ·{' '}
            {visibleRows.filter((r) => !r.matched).length} unmatched ·{' '}
            {visibleRows.length} shown
            {visibleRows.length !== rows.length && (
              <span className="text-coconut-400 dark:text-sand-300"> (of {rows.length})</span>
            )}
            {hiddenOwnedCount > 0 && (
              <span className="text-palm-500 dark:text-palm-200"> · {hiddenOwnedCount} owned hidden</span>
            )}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-sand-300 dark:border-husk-50">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-sand-300 dark:border-husk-50 bg-sand-100 dark:bg-husk-200 text-left">
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected
                  }}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-sand-300 text-palm-500 focus:ring-palm-400 dark:border-husk-50 dark:text-sun-300"
                />
              </th>
              {showSavedActions && (
                <th className="px-3 py-2 text-xs font-medium text-coconut-400 dark:text-sand-300 w-20">
                  <span className="sr-only">Save actions</span>
                </th>
              )}
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
              {settings.showEbay && (
                <th className="px-3 py-2 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden lg:table-cell">
                  eBay sold
                </th>
              )}
              <SortableHeader
                label="Source"
                column="source"
                active={sortColumn}
                dir={sortDir}
                onClick={cycleSort}
                className="hidden sm:table-cell"
              />
              <th className="px-3 py-2 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right">
                Buy
              </th>
            </tr>
            {showFilters && (
              <tr className="border-b border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200">
                <th>
                  <span className="sr-only">Select (no filter)</span>
                </th>
                {showSavedActions && (
                  <th>
                    <span className="sr-only">Save actions (no filter)</span>
                  </th>
                )}
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
                {settings.showEbay && (
                  <th className="hidden lg:table-cell">
                    <span className="sr-only">eBay sold (no filter)</span>
                  </th>
                )}
                <FilterCell className="hidden sm:table-cell">
                  <FilterInput
                    aria-label="Filter by source"
                    placeholder="contains…"
                    value={filters.source}
                    onChange={(v) => setFilterValue('source', v)}
                  />
                </FilterCell>
                <th>
                  <span className="sr-only">Buy (no filter)</span>
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {visibleRows.map((row, displayedIdx) => (
              <ResultRow
                key={rowKeys.get(row) ?? -1}
                row={row}
                showImage={!settings.noImages}
                showSavedActions={showSavedActions}
                showEbay={settings.showEbay}
                ownership={ownershipForRow(row, lookupOwnership)}
                onRerunLine={onRerunLine}
                onOpenDetail={() => setDetailIndex(displayedIdx)}
                selected={selected.has(row)}
                onSelect={(shiftKey) => toggleRow(displayedIdx, shiftKey)}
              />
            ))}
            {isRunning && (
              <tr>
                <td colSpan={14} className="py-2 px-3">
                  <div className="h-1 w-24 rounded animate-pulse bg-sand-200 dark:bg-husk-100" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(selectedRows.length > 0 || undoSnapshot !== null) && (
        <BulkActionBar
          selectedRows={selectedRows}
          onClear={clearSelection}
          onDelete={handleDelete}
          onRetag={handleRetag}
          canUndo={undoSnapshot !== null}
          onUndo={handleUndo}
          showBinderActions={showSavedActions}
        />
      )}

      <CardDetailModal
        rows={visibleRows}
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
  showEbay,
  ownership,
  onRerunLine,
  onOpenDetail,
  selected,
  onSelect,
}: {
  row: Row
  showImage: boolean
  showSavedActions: boolean
  showEbay: boolean
  ownership: CardOwnership | null | undefined
  onRerunLine?: (line: string) => void
  onOpenDetail?: () => void
  selected: boolean
  onSelect: (shiftKey: boolean) => void
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
        {/* Selection checkbox — onClick carries shiftKey for range select;
            a no-op onChange keeps the input controlled without a warning. */}
        <td className="px-3 py-1.5 w-8">
          <input
            type="checkbox"
            aria-label={`Select ${(card?.name as string) ?? row.query.raw}`}
            checked={selected}
            onClick={(e) => onSelect(e.shiftKey)}
            onChange={() => {}}
            className="h-3.5 w-3.5 rounded border-sand-300 text-palm-500 focus:ring-palm-400 dark:border-husk-50 dark:text-sun-300"
          />
        </td>

        {/* Row actions — pinned left so they stay visible on narrow
            viewports where the table overflows horizontally. */}
        {showSavedActions && (
          <td className="px-3 py-1.5 w-20">
            <div className="flex items-center gap-1">
              {row.matched && card && (
                <QuickActions
                  card={card as Record<string, unknown>}
                  ownership={ownership}
                  show
                  variant="icon"
                />
              )}
            </div>
          </td>
        )}

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
              <OwnershipBadge ownership={ownership} className="mt-0.5" />
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

        {/* eBay sold — median + sparkline of recent sales. Empty until the
            eBay source is wired into lookup (epic #416). */}
        {showEbay && (
          <td className="px-3 py-2 text-right hidden lg:table-cell">
            {p.ebay_sold_median != null ? (
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono tabular-nums text-xs text-coconut-600 dark:text-sand-200">
                  {formatMoney(p.ebay_sold_median, p.currency)}
                </span>
                <EbaySparkline
                  values={soldPriceSeries(p.ebay_sold_comps)}
                  currency={p.currency}
                  className="h-4 w-16"
                />
              </div>
            ) : (
              <span className="text-xs text-coconut-400 dark:text-sand-300">—</span>
            )}
          </td>
        )}

        {/* Price source */}
        <td className="px-3 py-2 text-xs text-coconut-400 dark:text-sand-300 hidden sm:table-cell">
          {p.source ?? '—'}
        </td>

        {/* Buy — the matched listing (if any) plus eBay + TCGPlayer affiliate
            search links (#657). Unmatched rows have no card to search, so the
            affiliate links omit themselves there. */}
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center justify-end gap-2">
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
            <AffiliateLinks card={card} />
          </div>
        </td>
      </tr>

      {/* Override URL form (inline, expands below row) */}
      {showOverrideForm && (
        <tr className="border-b border-sand-200 dark:border-husk-100 bg-sand-100 dark:bg-husk-200/60">
          <td colSpan={14} className="px-3 py-2">
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
