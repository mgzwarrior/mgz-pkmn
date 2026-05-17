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
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, AlertCircle, Filter } from 'lucide-react'
import { addOverride } from '../api/client'
import { useAppStore } from '../store'
import type { Row } from '../types'
import {
  applyFilters,
  applySort,
  EMPTY_FILTERS,
  hasActiveFilters,
  type Filters,
  type SortColumn,
  type SortDir,
} from './resultsTableFilter'

interface Props {
  onRerunLine?: (line: string) => void
}

export function ResultsTable({ onRerunLine }: Props) {
  const { rows, progress, isRunning, settings } = useAppStore()
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDir, setSortDir] = useState<SortDir | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)

  function cycleSort(column: SortColumn) {
    if (sortColumn !== column) {
      setSortColumn(column)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortColumn(null)
      setSortDir(null)
    }
  }

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
      <div className="flex items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 py-16 text-zinc-400 text-sm">
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
          <div className="flex-1 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          {progress && (
            <span className="text-xs text-zinc-400 tabular-nums whitespace-nowrap">
              {progress.done} / {progress.total}
            </span>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-pressed={showFilters}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
            showFilters
              ? 'border-blue-700 bg-blue-900/30 text-blue-300'
              : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
          }`}
        >
          <Filter size={12} />
          {showFilters ? 'Hide filters' : 'Filter'}
        </button>
        {(sortColumn || hasActiveFilters(filters)) && (
          <button
            type="button"
            onClick={() => {
              setSortColumn(null)
              setSortDir(null)
              setFilters(EMPTY_FILTERS)
            }}
            className="text-xs text-zinc-400 hover:text-zinc-300"
          >
            Clear sort &amp; filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-zinc-700">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-zinc-700 bg-zinc-800 text-left">
              {!settings.noImages && (
                <th className="px-3 py-2 text-xs font-medium text-zinc-400 w-16">Img</th>
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
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 text-right hidden xl:table-cell">80%</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 text-right hidden xl:table-cell">85%</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 text-right hidden xl:table-cell">90%</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 text-right hidden xl:table-cell">95%</th>
              <SortableHeader
                label="Source"
                column="source"
                active={sortColumn}
                dir={sortDir}
                onClick={cycleSort}
                className="hidden sm:table-cell"
              />
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 w-8">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
            {showFilters && (
              <tr className="border-b border-zinc-700 bg-zinc-900">
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
                    onChange={(v) => setFilters((f) => ({ ...f, name: v }))}
                  />
                </FilterCell>
                <FilterCell className="hidden md:table-cell">
                  <FilterInput
                    aria-label="Filter by set"
                    placeholder="contains…"
                    value={filters.set}
                    onChange={(v) => setFilters((f) => ({ ...f, set: v }))}
                  />
                </FilterCell>
                <FilterCell className="hidden lg:table-cell">
                  <FilterInput
                    aria-label="Filter by rarity"
                    placeholder="contains…"
                    value={filters.rarity}
                    onChange={(v) => setFilters((f) => ({ ...f, rarity: v }))}
                  />
                </FilterCell>
                <FilterCell>
                  <div className="flex gap-1">
                    <FilterInput
                      aria-label="Min market price"
                      type="number"
                      placeholder="min"
                      value={filters.marketMin}
                      onChange={(v) => setFilters((f) => ({ ...f, marketMin: v }))}
                    />
                    <FilterInput
                      aria-label="Max market price"
                      type="number"
                      placeholder="max"
                      value={filters.marketMax}
                      onChange={(v) => setFilters((f) => ({ ...f, marketMax: v }))}
                    />
                  </div>
                </FilterCell>
                <th className="hidden xl:table-cell" />
                <th className="hidden xl:table-cell" />
                <th className="hidden xl:table-cell" />
                <th className="hidden xl:table-cell" />
                <FilterCell className="hidden sm:table-cell">
                  <FilterInput
                    aria-label="Filter by source"
                    placeholder="contains…"
                    value={filters.source}
                    onChange={(v) => setFilters((f) => ({ ...f, source: v }))}
                  />
                </FilterCell>
                <th>
                  <span className="sr-only">Actions (no filter)</span>
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {displayedRows.map((row) => (
              <ResultRow
                key={rowKeys.get(row) ?? -1}
                row={row}
                showImage={!settings.noImages}
                onRerunLine={onRerunLine}
              />
            ))}
            {isRunning && (
              <tr>
                <td colSpan={12} className="py-2 px-3">
                  <div className="h-1 w-24 rounded animate-pulse bg-zinc-700" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-400 text-right">
        {displayedRows.filter((r) => r.matched).length} matched ·{' '}
        {displayedRows.filter((r) => !r.matched).length} unmatched ·{' '}
        {displayedRows.length} shown
        {displayedRows.length !== rows.length && (
          <span className="text-zinc-400"> (of {rows.length})</span>
        )}
      </p>
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
          isActive ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
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
      className="w-full rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  )
}

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------

function fmt(amount: number | null, currency = 'USD'): string {
  if (amount == null) return '—'
  const sym = currency === 'EUR' ? '€' : '$'
  return `${sym}${amount.toFixed(2)}`
}

function comp(market: number | null, pct: number): string {
  return market != null ? fmt((market * pct) / 100) : '—'
}

function ResultRow({
  row,
  showImage,
  onRerunLine,
}: {
  row: Row
  showImage: boolean
  onRerunLine?: (line: string) => void
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

  return (
    <>
      <tr
        className={`border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors motion-safe:animate-[fadeInRow_220ms_ease-out] ${
          !row.matched ? 'opacity-60' : ''
        } ${isOverCap ? 'bg-amber-950/30' : ''}`}
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
              <div className="w-10 h-14 rounded bg-zinc-800 flex items-center justify-center">
                <span className="text-zinc-400 text-xs">?</span>
              </div>
            )}
          </td>
        )}

        {/* Name */}
        <td className="px-3 py-2 max-w-[200px]">
          {row.matched ? (
            <div>
              <div className="font-medium text-zinc-100 truncate">{card?.name as string}</div>
              <div className="text-xs text-zinc-400 truncate">{row.query.raw}</div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1 text-zinc-400">
                <AlertCircle size={13} className="text-amber-400 flex-shrink-0" />
                <span className="truncate">{row.query.raw}</span>
              </div>
              <button
                onClick={() => setShowOverrideForm((v) => !v)}
                className="mt-0.5 text-xs text-blue-400 hover:text-blue-300 hover:underline"
              >
                + Add PriceCharting URL
              </button>
            </div>
          )}
        </td>

        {/* Set */}
        <td className="px-3 py-2 text-zinc-400 text-xs hidden md:table-cell max-w-[160px]">
          <div className="truncate">{setName ?? '—'}</div>
          {card?.number && (
            <div className="text-zinc-400">#{card.number as string}</div>
          )}
        </td>

        {/* Rarity */}
        <td className="px-3 py-2 text-xs text-zinc-400 hidden lg:table-cell max-w-[120px] truncate">
          {(card?.rarity as string | undefined) ?? '—'}
        </td>

        {/* Market */}
        <td
          className={`px-3 py-2 text-right font-mono tabular-nums ${
            isOverCap ? 'text-amber-400 font-bold' : p.market ? 'text-green-400' : 'text-zinc-400'
          }`}
        >
          {fmt(p.market, p.currency)}
        </td>

        {/* Comp tiers */}
        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 text-xs hidden xl:table-cell">
          {comp(p.market, 80)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 text-xs hidden xl:table-cell">
          {comp(p.market, 85)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 text-xs hidden xl:table-cell">
          {comp(p.market, 90)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 text-xs hidden xl:table-cell">
          {comp(p.market, 95)}
        </td>

        {/* Price source */}
        <td className="px-3 py-2 text-xs text-zinc-400 hidden sm:table-cell">
          {p.source ?? '—'}
        </td>

        {/* Link */}
        <td className="px-3 py-2 w-8">
          {p.url && (
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 hover:text-blue-400 transition-colors"
              title="Open listing"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </td>
      </tr>

      {/* Override URL form (inline, expands below row) */}
      {showOverrideForm && (
        <tr className="border-b border-zinc-800 bg-zinc-800/60">
          <td colSpan={12} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={overrideUrl}
                onChange={(e) => setOverrideUrl(e.target.value)}
                placeholder="https://www.pricecharting.com/game/pokemon-…"
                className="flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && handleSaveOverride()}
              />
              <button
                onClick={handleSaveOverride}
                disabled={overrideSaving || !overrideUrl.trim()}
                className="rounded bg-blue-700 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {overrideSaving ? 'Saving…' : 'Save & re-run'}
              </button>
              <button
                onClick={() => setShowOverrideForm(false)}
                className="text-zinc-400 hover:text-zinc-300 text-xs"
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
