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
 * `set_ids`; the backend filter restricts the PDF to those sets.
 * Picking nothing surfaces a small inline warning rather than firing
 * a doomed request (the API would 404 in that case).
 *
 * Logo thumbnails come from the new `/api/v1/sets/{id}/logo` endpoint,
 * which serves images out of the unified disk cache populated by
 * `pkmn cache warm-sets`. Sets without a cached logo render as a
 * text-only chip — the image's onError handler hides the broken
 * <img> so the row still looks intentional.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Check, ImageOff, Loader2, Tags, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { downloadSetCardsPdf, fetchSets, setLogoUrl } from '../api/client'
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

function groupBySeries(sets: SetInfo[]): SeriesGroup[] {
  // Preserve catalog order within each group (the API returns oldest →
  // newest), but emit groups in first-encounter order so familiar series
  // (Base, Jungle, Fossil) appear at the top for users who scan by era.
  const order: string[] = []
  const buckets = new Map<string, SetInfo[]>()
  for (const s of sets) {
    const key = s.series || 'Other'
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

  const [sets, setSets] = useState<SetInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Edit-in-place working copy so the user can cancel without persisting
  // changes. Seeded from the store on open via `handleOpenChange`, not in
  // an effect — keeping the open-transition reset event-driven satisfies
  // the no-setState-in-effect rule and matches the parent's controlled
  // semantics.
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selectedSetIds))

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(new Set(selectedSetIds))
      setSubmitError(null)
    }
    onOpenChange(next)
  }

  // Lazy-load the catalog once, the first time the modal opens. We keep
  // the result mounted across open/close so a re-open is free.
  useEffect(() => {
    if (!open || sets !== null) return
    let cancelled = false
    fetchSets(settings.apiKey || undefined)
      .then((data) => {
        if (cancelled) return
        setSets(data)
        setLoadError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [open, sets, settings.apiKey])

  const groups = useMemo(() => (sets ? groupBySeries(sets) : []), [sets])
  const allCount = sets?.length ?? 0
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
    if (!sets) return
    setDraft(new Set(sets.map((s) => s.id)))
  }

  function selectNone() {
    setDraft(new Set())
  }

  function selectSeries(series: string) {
    if (!sets) return
    setDraft((prev) => {
      const next = new Set(prev)
      for (const s of sets) if (s.series === series) next.add(s.id)
      return next
    })
  }

  async function handleSubmit() {
    if (draft.size === 0) {
      setSubmitError('Pick at least one set before downloading.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const ids = Array.from(draft)
      await downloadSetCardsPdf(settings.apiKey || undefined, ids)
      setSelectedSetIds(ids)
      onOpenChange(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
          aria-describedby="set-picker-description"
        >
          <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
            <div className="flex items-center gap-2">
              <Tags size={18} className="text-zinc-300" />
              <Dialog.Title className="text-lg font-semibold text-zinc-100">
                Choose sets
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>

          <Dialog.Description
            id="set-picker-description"
            className="px-5 pt-3 text-sm text-zinc-400"
          >
            Pick which Pokémon TCG sets the printable ID cards PDF should
            include. {sets ? `${selectedCount} of ${allCount} selected.` : ''}
          </Dialog.Description>

          {/* Bulk-action toolbar */}
          {sets && (
            <div className="flex flex-wrap gap-2 px-5 pt-3">
              <BulkButton onClick={selectAll}>Select all</BulkButton>
              <BulkButton onClick={selectNone}>Select none</BulkButton>
            </div>
          )}

          <div
            className="flex-1 overflow-y-auto px-5 py-3"
            tabIndex={0}
            aria-label="Set list"
          >
            {loadError && (
              <p className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                Couldn’t load sets: {loadError}
              </p>
            )}
            {!sets && !loadError && (
              <p className="flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 size={14} className="animate-spin" />
                Loading set catalog…
              </p>
            )}
            {sets && (
              <ul className="space-y-4">
                {groups.map((group) => (
                  <li key={group.series}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        {group.series}{' '}
                        <span className="font-normal text-zinc-500">
                          ({group.sets.length})
                        </span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => selectSeries(group.series)}
                        className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                      >
                        Select series
                      </button>
                    </div>
                    <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {group.sets.map((s) => (
                        <SetRow
                          key={s.id}
                          set={s}
                          checked={draft.has(s.id)}
                          onToggle={() => toggle(s.id)}
                        />
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-4">
            <div className="flex-1 text-xs text-zinc-400">
              {submitError && <span className="text-red-400">{submitError}</span>}
              {!submitError && sets && (
                <span>
                  {selectedCount} set{selectedCount === 1 ? '' : 's'} selected
                </span>
              )}
            </div>
            <Dialog.Close asChild>
              <button className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700">
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={handleSubmit}
              disabled={submitting || draft.size === 0 || !sets}
              className="flex items-center gap-1.5 rounded-md border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
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
      className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
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
          checked ? 'bg-blue-950/40 ring-1 ring-blue-700/40' : 'hover:bg-zinc-800/60'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="accent-blue-500"
          aria-label={`Include ${set.name}`}
        />
        <div className="flex h-8 w-12 flex-none items-center justify-center rounded bg-zinc-950/60">
          {logoFailed ? (
            <ImageOff size={14} className="text-zinc-600" aria-hidden />
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
          <div className="truncate text-sm text-zinc-100">{set.name}</div>
          <div className="truncate text-xs text-zinc-500">
            {year || '—'} · {set.total ? `${set.total} cards` : 'count unknown'}
          </div>
        </div>
      </label>
    </li>
  )
}
