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
 *
 * Below the `lg` breakpoint the table gives way to a stacked list of
 * {@link ResultCard}s (#521) — seven columns don't fit a phone, and Swipe
 * already established the card shape for this same data. Sort/filter move
 * from the inline header row into a bottom sheet opened from a sticky
 * "Filters" trigger, since there's no table to attach an inline row to.
 */
import { useCallback, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  AlertCircle,
  Filter,
  X,
} from 'lucide-react'
import { addOverride, hasPersonalOwnership, updateRunRowCondition } from '../api/client'
import { BulkActionBar } from './BulkActionBar'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import type { CardCondition, ResultsFilters, Row } from '../types'
import { formatComp, formatMoney } from '../utils/format'
import {
  conditionPricingForRow,
  multiplierFor,
  rowConditionKey,
  type ConditionPricing,
} from '../utils/conditionPricing'
import { QuickActions } from './QuickActions'
import { AffiliateLinks } from './AffiliateLinks'
import { CardDetailModal } from './CardDetailModal'
import { ConditionOverrideSelect } from './ConditionOverrideSelect'
import { ResultCard } from './ResultCard'
import { ResultsEmptyState } from './ResultsEmptyState'
import { useCardOwnership } from './useCardOwnership'
import { useIsMobileViewport } from './useIsMobileViewport'
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

const SORT_COLUMNS: { value: SortColumn; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'set', label: 'Set' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'market', label: 'Market' },
  { value: 'source', label: 'Source' },
]

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
 * Whether a resolved ownership means the card sits in at least one
 * `personal`-purpose collection (#339, purpose-aware per #707). Wishlist-only
 * occupancy ("chasing") doesn't count as owned — those are exactly the cards
 * the want-list view should keep, and neither does a card held only for
 * trade/bulk. `undefined` (not yet known) and `null` (no occupancy) are both
 * not-owned, so a row stays visible until its ownership resolves rather than
 * flickering out mid-stream.
 */
function isOwned(ownership: CardOwnership | null | undefined): boolean {
  return hasPersonalOwnership(ownership)
}

interface Props {
  onRerunLine?: (line: string) => void
  /** Run an example query from the empty state (#523). */
  onRun?: (text: string) => void
  /** Switch to Browse mode from the empty state's "Walk a set" entry point. */
  onBrowse?: () => void
}

export function ResultsTable({ onRerunLine, onRun, onBrowse }: Props) {
  const {
    rows,
    setRows,
    progress,
    isRunning,
    settings,
    rowConditionOverrides,
    currentRunId,
    setRowConditionOverride,
    viewState,
    setViewState,
    resetViewState,
  } = useAppStore()
  const { sortColumn, sortDir, showFilters, filters } = viewState
  // Hoist the auth read here (not in ResultRow) so we don't fire one
  // `/me` request per row on mount. Pass the boolean down — the rows
  // care about "should I render save buttons" not "who is the user".
  const auth = useAuth()
  const showSavedActions = auth.user !== null
  const isMobile = useIsMobileViewport()
  // Index into `displayedRows` for the row whose detail modal is open;
  // `null` keeps the modal closed. Tracking the index (not the row) lets
  // ←/→ navigation in the modal stay synced with the live filter+sort.
  const [detailIndex, setDetailIndex] = useState<number | null>(null)
  const [conditionSaveError, setConditionSaveError] = useState<string | null>(null)
  // Mobile-only: the desktop Filter toggle reveals an inline table row, but
  // there's no table to attach one to below `lg`, so a separate boolean
  // drives a bottom sheet instead (#521).
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  // Derived (not synced via effect): resizing to desktop while the sheet is
  // open should close it immediately, not on a following render — otherwise
  // Radix's focus trap / scroll lock stays active behind the `lg:hidden` overlay.
  const mobileFiltersSheetOpen = isMobile && mobileFiltersOpen

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

  // Mobile sheet's sort control is a direct column picker + a plain
  // asc/desc toggle, not the desktop header's 3-state cycle (asc → desc →
  // off) — a dedicated direction button that could suddenly clear sorting
  // on a second tap would be a confusing model for that control.
  const setSort = useCallback(
    (column: SortColumn | null) => {
      const current = useAppStore.getState().viewState
      setViewState({ ...current, sortColumn: column, sortDir: column ? 'asc' : null })
    },
    [setViewState],
  )

  const toggleSortDir = useCallback(() => {
    const current = useAppStore.getState().viewState
    if (!current.sortColumn) return
    setViewState({ ...current, sortDir: current.sortDir === 'asc' ? 'desc' : 'asc' })
  }, [setViewState])

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

  const adjustedMarketForRow = useCallback(
    (row: Row) => conditionPricingForRow(row, settings, rowConditionOverrides).adjustedMarket,
    [settings, rowConditionOverrides],
  )

  const displayedRows = useMemo(
    () => applySort(
      applyFilters(rows, filters, adjustedMarketForRow),
      sortColumn,
      sortDir,
      adjustedMarketForRow,
    ),
    [rows, filters, sortColumn, sortDir, adjustedMarketForRow],
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

  const handleConditionOverrideChange = useCallback(
    (row: Row, condition: CardCondition | null) => {
      setRowConditionOverride(rowConditionKey(row), condition)
      setConditionSaveError(null)
      const position = rowKeys.get(row)
      if (currentRunId == null || position == null) return
      const patch =
        condition === null
          ? {
              condition: null,
              condition_multiplier: null,
            }
          : {
              condition,
              condition_multiplier: multiplierFor(condition, settings.conditionMultipliers),
            }
      void updateRunRowCondition(currentRunId, position, patch).catch((err: unknown) => {
        setConditionSaveError(
          err instanceof Error && err.message === 'sign-in required'
            ? 'Sign in to keep condition overrides across visits.'
            : 'Condition override was not saved.',
        )
      })
    },
    [currentRunId, rowKeys, setRowConditionOverride, settings.conditionMultipliers],
  )

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
  // Gated on `hidePricing` too (review feedback on #878) — the eBay column
  // shows a sold price + sparkline, which leaks pricing even with the
  // column itself opted into separately via `showEbay`.
  const showEbay = settings.showEbay && !settings.hidePricing
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

  // Crossing the mobile/desktop breakpoint: multi-select is a desktop-table
  // affordance (the card list has no checkboxes), so a selection made before
  // resizing down would otherwise sit invisibly behind BulkActionBar, which
  // isn't gated on `isMobile` and would still be able to act on it. Going the
  // other way, an open mobile filters sheet should reset rather than silently
  // reopening next time the viewport crosses back under `lg`.
  const [prevIsMobile, setPrevIsMobile] = useState(isMobile)
  if (isMobile !== prevIsMobile) {
    setPrevIsMobile(isMobile)
    if (isMobile) {
      if (selected.size > 0 || anchorIdx !== null) {
        setSelected(new Set())
        setAnchorIdx(null)
      }
    } else if (mobileFiltersOpen) {
      setMobileFiltersOpen(false)
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
        {isMobile ? (
          // Opens the Filters + Sort bottom sheet — there's no table row
          // for an inline toggle to reveal.
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            aria-expanded={mobileFiltersOpen}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
              sortColumn || hasActiveFilters(filters)
                ? 'border-palm-400 bg-palm-50 text-palm-700 dark:border-sun-300/60 dark:bg-sun-400/15 dark:text-sun-300'
                : 'border-sand-300 dark:border-husk-50 bg-sand-100 dark:bg-husk-200 text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100'
            }`}
          >
            <Filter size={12} />
            Filters
          </button>
        ) : (
          // Toggles the inline table filter row below.
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
        )}
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
      {conditionSaveError && (
        <p role="status" className="text-xs text-ember-500 dark:text-ember-300">
          {conditionSaveError}
        </p>
      )}

      {/* Table — desktop only; mobile renders ResultCards below (#521). */}
      {!isMobile && (
      <div className="overflow-x-auto rounded-md border border-sand-300 dark:border-husk-50">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-sand-300 dark:border-husk-50 bg-sand-100 dark:bg-husk-200 text-left">
              <th className="px-3 py-2 compact:py-1 w-8">
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
                <th className="px-3 py-2 compact:py-1 text-xs font-medium text-coconut-400 dark:text-sand-300 w-20">
                  <span className="sr-only">Save actions</span>
                </th>
              )}
              {!settings.noImages && (
                <th className="px-3 py-2 compact:py-1 text-xs font-medium text-coconut-400 dark:text-sand-300 w-16">Img</th>
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
              {!settings.hidePricing && (
                <>
                  <th className="px-3 py-2 compact:py-1 text-xs font-medium text-coconut-400 dark:text-sand-300 text-left">
                    Cond.
                  </th>
                  <SortableHeader
                    label="Adj. market"
                    column="market"
                    active={sortColumn}
                    dir={sortDir}
                    onClick={cycleSort}
                    align="right"
                  />
                  <th className="px-3 py-2 compact:py-1 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden xl:table-cell">80%</th>
                  <th className="px-3 py-2 compact:py-1 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden xl:table-cell">85%</th>
                  <th className="px-3 py-2 compact:py-1 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden xl:table-cell">90%</th>
                  <th className="px-3 py-2 compact:py-1 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden xl:table-cell">95%</th>
                </>
              )}
              {showEbay && (
                <th className="px-3 py-2 compact:py-1 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right hidden lg:table-cell">
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
              <th className="px-3 py-2 compact:py-1 text-xs font-medium text-coconut-400 dark:text-sand-300 text-right">
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
                {!settings.hidePricing && (
                  <>
                    <th>
                      <span className="sr-only">Condition (no filter)</span>
                    </th>
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
                    {/* Comp-tier columns have no filter — sr-only labels keep
                        axe happy without adding visible noise. */}
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
                  </>
                )}
                {showEbay && (
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
                conditionPricing={conditionPricingForRow(row, settings, rowConditionOverrides)}
                conditionOverride={rowConditionOverrides[rowConditionKey(row)] ?? null}
                defaultCondition={settings.condition ?? 'NM'}
                onConditionOverrideChange={(condition) =>
                  handleConditionOverrideChange(row, condition)
                }
                showImage={!settings.noImages}
                showSavedActions={showSavedActions}
                showMarket={!settings.hidePricing}
                showEbay={showEbay}
                ownership={ownershipForRow(row, lookupOwnership)}
                onRerunLine={onRerunLine}
                onOpenDetail={() => setDetailIndex(displayedIdx)}
                selected={selected.has(row)}
                onSelect={(shiftKey) => toggleRow(displayedIdx, shiftKey)}
              />
            ))}
            {isRunning && (
              <tr>
                <td colSpan={15} className="py-2 px-3 compact:py-1">
                  <div className="h-1 w-24 rounded animate-pulse bg-sand-200 dark:bg-husk-100" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* Card list — mobile only (#521). No multi-select here: bulk actions
          stay a desktop-table affordance, so BulkActionBar only ever shows
          alongside the table. */}
      {isMobile && (
      <ul className="flex flex-col gap-2">
        {visibleRows.map((row, displayedIdx) => (
          <ResultCard
            key={rowKeys.get(row) ?? -1}
            row={row}
            conditionPricing={conditionPricingForRow(row, settings, rowConditionOverrides)}
            conditionOverride={rowConditionOverrides[rowConditionKey(row)] ?? null}
            defaultCondition={settings.condition ?? 'NM'}
            onConditionOverrideChange={(condition) =>
              handleConditionOverrideChange(row, condition)
            }
            showImage={!settings.noImages}
            showSavedActions={showSavedActions}
            showMarket={!settings.hidePricing}
            ownership={ownershipForRow(row, lookupOwnership)}
            onRerunLine={onRerunLine}
            onOpenDetail={() => setDetailIndex(displayedIdx)}
          />
        ))}
        {isRunning && (
          <li className="h-1 w-24 animate-pulse rounded bg-sand-200 dark:bg-husk-100" />
        )}
      </ul>
      )}

      <MobileFiltersSheet
        open={mobileFiltersSheetOpen}
        onOpenChange={setMobileFiltersOpen}
        sortColumn={sortColumn}
        sortDir={sortDir}
        onSetSort={setSort}
        onToggleSortDir={toggleSortDir}
        filters={filters}
        onFilterChange={setFilterValue}
        onClear={resetViewState}
        hasActive={!!sortColumn || hasActiveFilters(filters)}
        showMarket={!settings.hidePricing}
      />

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
        onConditionOverrideChange={handleConditionOverrideChange}
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
      className={`px-3 py-2 compact:py-1 text-xs font-medium ${align === 'right' ? 'text-right' : ''} ${className}`}
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
  return <th className={`px-2 py-1.5 compact:py-0.5 ${className}`}>{children}</th>
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
// Mobile filters + sort sheet (#521)
// ---------------------------------------------------------------------------

function MobileFiltersSheet({
  open,
  onOpenChange,
  sortColumn,
  sortDir,
  onSetSort,
  onToggleSortDir,
  filters,
  onFilterChange,
  onClear,
  hasActive,
  showMarket,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sortColumn: SortColumn | null
  sortDir: SortDir | null
  onSetSort: (c: SortColumn | null) => void
  onToggleSortDir: () => void
  filters: ResultsFilters
  onFilterChange: <K extends keyof ResultsFilters>(key: K, value: ResultsFilters[K]) => void
  onClear: () => void
  hasActive: boolean
  showMarket: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm lg:hidden dark:bg-husk-500/70" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-t-2xl border-t border-sand-300 bg-sand-50 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 shadow-2xl lg:hidden dark:border-husk-50 dark:bg-husk-200">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-coconut-700 dark:text-sand-50">
              Filters &amp; sort
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded p-1 text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
              >
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Sort the results and filter by name, set, rarity, price, or source.
          </Dialog.Description>

          <SheetField label="Sort by">
            <div className="flex gap-2">
              <select
                aria-label="Sort column"
                value={sortColumn ?? ''}
                onChange={(e) => onSetSort(e.target.value === '' ? null : (e.target.value as SortColumn))}
                className="flex-1 rounded border border-sand-300 bg-sand-100 px-2 py-1.5 text-sm text-coconut-700 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:focus:ring-sun-300"
              >
                <option value="">None</option>
                {SORT_COLUMNS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              {sortColumn && (
                <button
                  type="button"
                  onClick={onToggleSortDir}
                  aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
                  className="flex items-center gap-1 rounded border border-sand-300 bg-sand-100 px-2 py-1.5 text-xs text-coconut-600 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-200"
                >
                  {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                </button>
              )}
            </div>
          </SheetField>

          <SheetField label="Name">
            <FilterInput
              aria-label="Filter by name"
              placeholder="contains…"
              value={filters.name}
              onChange={(v) => onFilterChange('name', v)}
            />
          </SheetField>
          <SheetField label="Set">
            <FilterInput
              aria-label="Filter by set"
              placeholder="contains…"
              value={filters.set}
              onChange={(v) => onFilterChange('set', v)}
            />
          </SheetField>
          <SheetField label="Rarity">
            <FilterInput
              aria-label="Filter by rarity"
              placeholder="contains…"
              value={filters.rarity}
              onChange={(v) => onFilterChange('rarity', v)}
            />
          </SheetField>
          {showMarket && (
            <SheetField label="Market price">
              <div className="flex gap-2">
                <FilterInput
                  aria-label="Min market price"
                  type="number"
                  placeholder="min"
                  value={filters.marketMin}
                  onChange={(v) => onFilterChange('marketMin', v)}
                />
                <FilterInput
                  aria-label="Max market price"
                  type="number"
                  placeholder="max"
                  value={filters.marketMax}
                  onChange={(v) => onFilterChange('marketMax', v)}
                />
              </div>
            </SheetField>
          )}
          <SheetField label="Source">
            <FilterInput
              aria-label="Filter by source"
              placeholder="contains…"
              value={filters.source}
              onChange={(v) => onFilterChange('source', v)}
            />
          </SheetField>

          {hasActive && (
            <button
              type="button"
              onClick={onClear}
              className="mt-1 text-sm text-coconut-400 hover:text-coconut-600 dark:text-sand-300 dark:hover:text-sand-200"
            >
              Clear sort &amp; filters
            </button>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Not a <label> — several fields group more than one labelable control (the
// sort column + direction button, the min/max market inputs), and a <label>
// wrapping multiple controls is invalid HTML that confuses assistive tech.
// Each inner input already carries its own aria-label.
function SheetField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-coconut-400 dark:text-sand-300">
      <span>{label}</span>
      {children}
    </div>
  )
}

function PriceStack({
  primary,
  secondary,
}: {
  primary: string
  secondary?: string
}) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{primary}</span>
      {secondary && (
        <span className="text-[10px] font-normal text-coconut-400 dark:text-sand-400">
          {secondary}
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------

function ResultRow({
  row,
  conditionPricing,
  conditionOverride,
  defaultCondition,
  onConditionOverrideChange,
  showImage,
  showSavedActions,
  showMarket,
  showEbay,
  ownership,
  onRerunLine,
  onOpenDetail,
  selected,
  onSelect,
}: {
  row: Row
  conditionPricing: ConditionPricing
  conditionOverride: CardCondition | null
  defaultCondition: CardCondition
  onConditionOverrideChange: (condition: CardCondition | null) => void
  showImage: boolean
  showSavedActions: boolean
  showMarket: boolean
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
  // Gated on `showMarket` too — the amber "over cap" row highlight is a
  // pricing signal on its own, so it stays off when pricing is hidden even
  // though the underlying cap still governs what a bulk lookup excludes.
  const isOverCap =
    showMarket &&
    useAppStore.getState().settings.maxPrice != null &&
    conditionPricing.adjustedMarket != null &&
    conditionPricing.adjustedMarket > (useAppStore.getState().settings.maxPrice ?? Infinity)

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
        <td className="px-3 py-1.5 compact:py-0.5 w-8">
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
          <td className="px-3 py-1.5 compact:py-0.5 w-20">
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
          <td className="px-3 py-1.5 compact:py-0.5 w-16">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={card?.name as string}
                className="w-10 h-14 compact:h-10 compact:w-7 object-contain rounded"
                loading="lazy"
              />
            ) : (
              <div className="w-10 h-14 compact:h-10 compact:w-7 rounded bg-sand-100 dark:bg-husk-200 flex items-center justify-center">
                <span className="text-coconut-400 dark:text-sand-300 text-xs">?</span>
              </div>
            )}
          </td>
        )}

        {/* Name */}
        <td className="px-3 py-2 compact:py-1 max-w-[200px]">
          {row.matched ? (
            <div>
              <div className="font-medium text-coconut-700 dark:text-sand-50 truncate">{card?.name as string}</div>
              {/* The raw-query echo is redundant while inventorying a long
                  list (it's still in the editor), so compact reclaims the
                  line — the biggest single win toward its tighter rhythm. */}
              <div className="text-xs text-coconut-400 dark:text-sand-300 truncate compact:hidden">{row.query.raw}</div>
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

        {/* Set — name over number; compact folds them onto one line so
            this cell stops setting the row height. */}
        <td className="px-3 py-2 compact:py-1 text-coconut-400 dark:text-sand-300 text-xs hidden md:table-cell max-w-[160px]">
          <div className="compact:flex compact:items-baseline compact:gap-1">
            <div className="truncate">{setName ?? '—'}</div>
            {card?.number && (
              <div className="shrink-0 text-coconut-400 dark:text-sand-300">#{card.number as string}</div>
            )}
          </div>
        </td>

        {/* Rarity */}
        <td className="px-3 py-2 compact:py-1 text-xs text-coconut-400 dark:text-sand-300 hidden lg:table-cell max-w-[120px] truncate">
          {(card?.rarity as string | undefined) ?? '—'}
        </td>

        {showMarket && (
          <>
            {/* Condition override */}
            <td className="px-3 py-2 compact:py-1">
              {row.matched ? (
                <ConditionOverrideSelect
                  label={`Condition for ${(card?.name as string | undefined) ?? row.query.raw}`}
                  value={conditionOverride}
                  defaultCondition={defaultCondition}
                  onChange={onConditionOverrideChange}
                />
              ) : (
                <span className="text-xs text-coconut-400 dark:text-sand-300">—</span>
              )}
            </td>

            {/* Market */}
            <td
              className={`px-3 py-2 compact:py-1 text-right font-mono tabular-nums ${
                isOverCap ? 'text-sun-600 dark:text-sun-300 font-bold' : conditionPricing.adjustedMarket != null ? 'text-palm-500 dark:text-palm-200' : 'text-coconut-400 dark:text-sand-300'
              }`}
            >
              <PriceStack
                primary={formatMoney(conditionPricing.adjustedMarket, p.currency)}
                secondary={
                  conditionPricing.hasAdjustment
                    ? `NM ${formatMoney(p.market, p.currency)}`
                    : undefined
                }
              />
            </td>

            {/* Comp tiers */}
            <td className="px-3 py-2 compact:py-1 text-right font-mono tabular-nums text-coconut-400 dark:text-sand-300 text-xs hidden xl:table-cell">
              <PriceStack
                primary={formatComp(conditionPricing.adjustedMarket, 80, p.currency)}
                secondary={
                  conditionPricing.hasAdjustment
                    ? `NM ${formatComp(p.market, 80, p.currency)}`
                    : undefined
                }
              />
            </td>
            <td className="px-3 py-2 compact:py-1 text-right font-mono tabular-nums text-coconut-400 dark:text-sand-300 text-xs hidden xl:table-cell">
              <PriceStack
                primary={formatComp(conditionPricing.adjustedMarket, 85, p.currency)}
                secondary={
                  conditionPricing.hasAdjustment
                    ? `NM ${formatComp(p.market, 85, p.currency)}`
                    : undefined
                }
              />
            </td>
            <td className="px-3 py-2 compact:py-1 text-right font-mono tabular-nums text-coconut-400 dark:text-sand-300 text-xs hidden xl:table-cell">
              <PriceStack
                primary={formatComp(conditionPricing.adjustedMarket, 90, p.currency)}
                secondary={
                  conditionPricing.hasAdjustment
                    ? `NM ${formatComp(p.market, 90, p.currency)}`
                    : undefined
                }
              />
            </td>
            <td className="px-3 py-2 compact:py-1 text-right font-mono tabular-nums text-coconut-400 dark:text-sand-300 text-xs hidden xl:table-cell">
              <PriceStack
                primary={formatComp(conditionPricing.adjustedMarket, 95, p.currency)}
                secondary={
                  conditionPricing.hasAdjustment
                    ? `NM ${formatComp(p.market, 95, p.currency)}`
                    : undefined
                }
              />
            </td>
          </>
        )}

        {/* eBay sold — median + sparkline of recent sales. Empty until the
            eBay source is wired into lookup (epic #416). */}
        {showEbay && (
          <td className="px-3 py-2 compact:py-1 text-right hidden lg:table-cell">
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
        <td className="px-3 py-2 compact:py-1 text-xs text-coconut-400 dark:text-sand-300 hidden sm:table-cell">
          {p.source ?? '—'}
        </td>

        {/* Buy — the matched listing (if any) plus eBay + TCGPlayer affiliate
            search links (#657). Unmatched rows have no card to search, so the
            affiliate links omit themselves there. */}
        <td className="px-3 py-2 compact:py-1 whitespace-nowrap">
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
          <td colSpan={15} className="px-3 py-2 compact:py-1">
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
