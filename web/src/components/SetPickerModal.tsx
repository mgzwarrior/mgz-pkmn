/**
 * SetPickerModal — choose which Pokémon TCG sets to include in the
 * printable Set ID cards PDF.
 *
 * The full catalog is fetched from `/api/v1/sets` and grouped by series.
 * Each row is a checkbox + logo thumbnail + name + year + total. The
 * user's selection is held in Zustand (persisted across reloads) so
 * reopening the modal restores it. Select all / none / per-series
 * buttons collapse the common cases.
 *
 * Submitting the modal calls `downloadSetCardsPdf` with the selected
 * `set_ids`; the backend filter restricts the PDF to those sets. The
 * Download button is intentionally disabled when nothing is selected:
 * the backend would happily accept an empty filter as "every set" and
 * render a 173-page PDF, but that's almost never what someone hitting
 * "Set ID cards…" wants right after opening the modal.
 *
 * Logo thumbnails come from the new `/api/v1/sets/{id}/logo` endpoint,
 * which serves images out of the unified disk cache populated by
 * `pkmn cache warm-sets`. Sets without a cached logo render as a
 * text-only chip — the image's onError handler hides the broken
 * <img> so the row still looks intentional.
 */
import * as Dialog from '@radix-ui/react-dialog'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ImageOff,
  Loader2,
  Tags,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { downloadSetCardsPdf, fetchSets, setLogoUrl } from '../api/client'
import { BAKED_SETS } from '../data/sets'
import { useAppStore } from '../store'
import type { SetInfo } from '../types'

interface Props {
  /** Controlled open state — the parent (ExportBar) owns the toggle. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SeriesGroup {
  series: string
  sets: SetInfo[]
}

// Display key for sets whose `series` field is missing or empty. Kept
// as a module-level constant so `selectSeries` and `groupBySeries` can
// match the same value — otherwise the bucket name wouldn't line up
// with the predicate the bulk-select button uses.
const OTHER_SERIES = 'Other'

function seriesKey(set: SetInfo): string {
  return set.series || OTHER_SERIES
}

function groupBySeries(sets: SetInfo[]): SeriesGroup[] {
  // The catalog comes from `/api/v1/sets` in oldest → newest order.
  // We render the picker newest-first because the typical prep workflow
  // biases toward modern sets (Scarlet & Violet, Mega Evolution); having
  // them at the top means a typical user picks 2–3 boxes without ever
  // scrolling. Within each series, rows stay newest-first too — within
  // S&V, Surging Sparks beats the 2023 set that opened the block.
  //
  // Implementation: walk the catalog in reverse and push each set into
  // its series bucket. Because we iterate newest → oldest, both the
  // group order (first-encounter wins) and each bucket's contents come
  // out newest-first — no per-bucket reverse needed.
  const order: string[] = []
  const buckets = new Map<string, SetInfo[]>()
  for (let i = sets.length - 1; i >= 0; i--) {
    const s = sets[i]
    const key = seriesKey(s)
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)!.push(s)
  }
  return order.map((series) => ({ series, sets: buckets.get(series)! }))
}

function releaseYear(date: string): string | null {
  const match = /^(\d{4})/.exec(date || '')
  return match ? match[1] : null
}

export function SetPickerModal({ open, onOpenChange }: Props) {
  const { settings, selectedSetIds, setSelectedSetIds } = useAppStore()

  // Seed from the baked catalog so the picker opens with rows visible
  // on the first frame — no "Loading set catalog…" tax. The live
  // `/api/v1/sets` fetch runs in the background to revalidate; see
  // the effect below. A transient revalidation failure is silently
  // swallowed because the baked content is already a working list.
  const [sets, setSets] = useState<SetInfo[]>(BAKED_SETS)
  const [revalidatedSets, setRevalidatedSets] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Edit-in-place working copy so the user can cancel without persisting
  // changes. Reseeded on every closed → open transition by the effect
  // below, not in `handleOpenChange`: Radix only fires `onOpenChange`
  // for its own state-change requests (Escape, outside click, close
  // button). A parent-driven open like `ExportBar`'s
  // `setPickerOpen(true)` flips the `open` prop without going through
  // that callback, so an effect that watches the prop is the only
  // place that catches every entry into the modal.
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selectedSetIds))

  // Series whose set list is collapsed. All groups start expanded; the
  // "Collapse all" toolbar button is the one-click way to shorten the
  // 173-set list when the user only wants one or two series.
  const [collapsedSeries, setCollapsedSeries] = useState<Set<string>>(() => new Set())

  // Reseed draft + clear transient errors whenever the modal becomes
  // visible. `selectedSetIds` is intentionally excluded from deps:
  // we only want to reset on the open transition, not on every store
  // update that lands while the modal is already open (which would
  // clobber the user's in-flight edits). The setState-in-effect rule
  // is suppressed because reacting to a prop transition is exactly
  // this rule's documented escape hatch.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!open) return
    setDraft(new Set(selectedSetIds))
    setSubmitError(null)
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Background revalidation of the catalog. Runs once per session on
  // the first open — the picker is already rendering the baked
  // catalog, so this fetch is off the critical path. Errors are
  // swallowed: the user has a working list either way, and a red
  // banner over an otherwise usable picker reads as broken even when
  // the bake is fine.
  useEffect(() => {
    if (!open || revalidatedSets) return
    let cancelled = false
    const load = async () => {
      try {
        const data = await fetchSets(settings.apiKey || undefined)
        if (!cancelled) setSets(data)
      } catch {
        // Swallow — baked catalog is already rendered.
      } finally {
        if (!cancelled) setRevalidatedSets(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, revalidatedSets, settings.apiKey])

  const groups = useMemo(() => groupBySeries(sets), [sets])
  const allCount = sets.length
  const selectedCount = draft.size

  function toggle(id: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setDraft(new Set(sets.map((s) => s.id)))
  }

  function selectNone() {
    setDraft(new Set())
  }

  function selectSeries(series: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      // Use the same keying as `groupBySeries` so the "Other" bucket
      // (sets with an empty / missing `series` field) actually picks
      // its members. A naive `s.series === series` check would miss
      // every member of "Other" because their underlying value is `''`,
      // not the literal "Other".
      for (const s of sets) if (seriesKey(s) === series) next.add(s.id)
      return next
    })
  }

  function toggleSeriesCollapsed(series: string) {
    setCollapsedSeries((prev) => {
      const next = new Set(prev)
      if (next.has(series)) next.delete(series)
      else next.add(series)
      return next
    })
  }

  function expandAllSeries() {
    setCollapsedSeries(new Set())
  }

  function collapseAllSeries() {
    setCollapsedSeries(new Set(groups.map((g) => g.series)))
  }

  async function handleSubmit() {
    // The Download button is disabled when `draft.size === 0`, so this
    // function should only be reached with a non-empty selection. No
    // empty-draft guard here on purpose — the disabled state is the
    // single source of truth for "can't submit yet."
    setSubmitting(true)
    setSubmitError(null)
    try {
      const ids = Array.from(draft)
      await downloadSetCardsPdf(
        settings.apiKey || undefined,
        ids,
        settings.darkPdfExports ? 'dark' : 'light',
      )
      setSelectedSetIds(ids)
      onOpenChange(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 dark:bg-husk-500/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200 shadow-2xl"
          aria-describedby="set-picker-description"
        >
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 dark:border-husk-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <Tags size={18} className="text-coconut-600 dark:text-sand-200" />
              <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
                Choose sets
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-700 dark:hover:text-sand-50"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>

          <Dialog.Description
            id="set-picker-description"
            className="px-5 pt-3 text-sm text-coconut-400 dark:text-sand-300"
          >
            Pick which Pokémon TCG sets the printable ID cards PDF should
            include. {`${selectedCount} of ${allCount} selected.`}
          </Dialog.Description>

          {/* Bulk-action toolbar */}
          <div className="flex flex-wrap gap-2 px-5 pt-3">
            <BulkButton onClick={selectAll}>Select all</BulkButton>
            <BulkButton onClick={selectNone}>Select none</BulkButton>
            <BulkButton onClick={expandAllSeries}>Expand all</BulkButton>
            <BulkButton onClick={collapseAllSeries}>Collapse all</BulkButton>
          </div>

          <div
            className="flex-1 overflow-y-auto px-5 py-3"
            tabIndex={0}
            aria-label="Set list"
          >
            {/* No loading / error state — the SPA seeds from the baked
                 catalog in `web/src/data/sets.json`, so `groups` is
                 always non-empty on first render. The live fetch
                 silently revalidates off the critical path. */}
            <ul className="space-y-4">
              {groups.map((group) => {
                  const collapsed = collapsedSeries.has(group.series)
                  const seriesIds = group.sets.map((s) => s.id)
                  const selectedInSeries = seriesIds.filter((id) => draft.has(id)).length
                  const headerId = `set-picker-series-${group.series.replace(/[^a-z0-9]+/gi, '-')}`
                  return (
                    <li key={group.series}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          aria-expanded={!collapsed}
                          aria-controls={headerId}
                          onClick={() => toggleSeriesCollapsed(group.series)}
                          className="flex items-center gap-1.5 rounded text-left text-xs font-semibold uppercase tracking-wider text-coconut-600 dark:text-sand-200 hover:text-coconut-700 dark:hover:text-sand-50 focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50"
                        >
                          {collapsed ? (
                            <ChevronRight size={14} aria-hidden className="text-coconut-400 dark:text-sand-400" />
                          ) : (
                            <ChevronDown size={14} aria-hidden className="text-coconut-400 dark:text-sand-400" />
                          )}
                          {group.series}{' '}
                          <span className="font-normal normal-case tracking-normal text-coconut-400 dark:text-sand-400">
                            {selectedInSeries > 0
                              ? `(${selectedInSeries}/${group.sets.length})`
                              : `(${group.sets.length})`}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => selectSeries(group.series)}
                          className="text-xs text-coconut-400 dark:text-sand-300 underline-offset-2 hover:text-coconut-600 dark:hover:text-sand-200 hover:underline"
                        >
                          Select series
                        </button>
                      </div>
                      {!collapsed && (
                        <ul
                          id={headerId}
                          className="grid grid-cols-1 gap-1 sm:grid-cols-2"
                        >
                          {group.sets.map((s) => (
                            <SetRow
                              key={s.id}
                              set={s}
                              checked={draft.has(s.id)}
                              onToggle={() => toggle(s.id)}
                            />
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
            </ul>
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-sand-200 dark:border-husk-100 px-5 py-4">
            <div className="flex-1 text-xs text-coconut-400 dark:text-sand-300">
              {submitError && <span className="text-ember-500 dark:text-ember-300">{submitError}</span>}
              {!submitError && (
                <span>
                  {selectedCount} set{selectedCount === 1 ? '' : 's'} selected
                </span>
              )}
            </div>
            <Dialog.Close asChild>
              <button className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-600 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100">
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={handleSubmit}
              disabled={submitting || draft.size === 0}
              className="flex items-center gap-1.5 rounded-md border border-palm-400 dark:border-sun-400 bg-sun-400 dark:bg-sun-400 px-3 py-1.5 text-sm font-medium text-coconut-700 dark:text-husk-500 hover:bg-sun-300 dark:hover:bg-sun-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Download PDF
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function BulkButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2.5 py-1 text-xs text-coconut-600 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100"
    >
      {children}
    </button>
  )
}

interface RowProps {
  set: SetInfo
  checked: boolean
  onToggle: () => void
}

function SetRow({ set, checked, onToggle }: RowProps) {
  const [logoFailed, setLogoFailed] = useState(false)
  const year = releaseYear(set.releaseDate)
  return (
    <li>
      <label
        className={`flex items-center gap-3 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
          checked ? 'bg-palm-50 ring-1 ring-palm-500 dark:bg-sun-400/15 dark:ring-sun-400/40' : 'hover:bg-sand-200 dark:hover:bg-husk-100/60'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="accent-palm-500 dark:accent-sun-300"
          aria-label={`Include ${set.name}`}
        />
        <div className="flex h-8 w-12 flex-none items-center justify-center rounded bg-sand-50 dark:bg-husk-400/60">
          {logoFailed ? (
            <ImageOff size={14} className="text-coconut-300 dark:text-sand-500" aria-hidden />
          ) : (
            // Cached logo from /api/v1/sets/{id}/logo. The endpoint 404s for
            // un-warmed sets; onError hides the broken image so the row
            // still renders as text + a muted glyph.
            <img
              src={setLogoUrl(set.id)}
              alt=""
              className="max-h-7 max-w-11 object-contain"
              loading="lazy"
              onError={() => setLogoFailed(true)}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-coconut-700 dark:text-sand-50">{set.name}</div>
          <div className="truncate text-xs text-coconut-400 dark:text-sand-400">
            {year || '—'} · {set.total ? `${set.total} cards` : 'count unknown'}
          </div>
        </div>
      </label>
    </li>
  )
}
