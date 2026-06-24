/**
 * BulkActionBar — floating action bar for the results-table multi-select
 * (#268). Slides up from the bottom when ≥1 row is selected and offers:
 *
 * - **Save actions** — the one-tap `Want` / `Own` bulk toggles, the
 *   multi-select mirror of the inline quick actions (#761, #781). Each writes
 *   every selected matched card to the user's default wishlist / collection;
 *   organizing into a specific binder is the separate picker flow (#762).
 * - **View actions** — drop the selected rows from the current results
 *   view, retag them (the export source tag), or export only the selection.
 *
 * Delete and retag mutate the ephemeral results rows in the store via the
 * parent's callbacks; the parent keeps the removed rows so Undo can restore
 * the last delete. Save/Export tones follow the owned=palm / chasing=sun
 * read (#576).
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Book,
  Check,
  Download,
  Footprints,
  Loader2,
  RotateCcw,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { exportFile, ownCard, wantCard } from '../api/client'
import { useAppStore } from '../store'
import type { ExportFormat, Row } from '../types'
import { invalidateOwnership } from './useCardOwnership'
import { useCollections } from './useCollections'
import { useWishlists } from './useWishlists'
import { QUICK_ACTION_TONES } from './quickActionTones'

const EXPORT_FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'xlsx', label: 'Download .xlsx' },
  { format: 'pdf', label: 'PDF binder' },
  { format: 'condensed-pdf', label: 'Condensed PDF' },
  { format: 'checklist', label: 'Checklist' },
]

interface Props {
  selectedRows: Row[]
  onClear: () => void
  onDelete: () => void
  onRetag: (tag: string) => void
  canUndo: boolean
  onUndo: () => void
  /** Show the add-to-binder pickers. Signed-out users have no library, so
   *  the parent passes false and only the view actions (retag / export /
   *  delete) render. */
  showBinderActions: boolean
}

export function BulkActionBar({
  selectedRows,
  onClear,
  onDelete,
  onRetag,
  canUndo,
  onUndo,
  showBinderActions,
}: Props) {
  const settings = useAppStore((s) => s.settings)
  const cards = selectedRows
    .filter((r) => r.matched && r.card)
    .map((r) => r.card as unknown as Record<string, unknown>)
  const count = selectedRows.length

  const [retagOpen, setRetagOpen] = useState(false)
  const [tag, setTag] = useState('')
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  function submitRetag() {
    onRetag(tag.trim())
    setTag('')
    setRetagOpen(false)
  }

  async function handleExport(format: ExportFormat) {
    setExporting(format)
    setError(null)
    try {
      await exportFile(selectedRows, format, {
        maxPrice: settings.maxPrice,
        title: settings.tag || 'cards',
        sort: settings.sort,
        noImages: settings.noImages,
        dedupe: settings.dedupe,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[95vw] flex-col items-center gap-1"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-full border border-sand-300 bg-sand-50/95 px-3 py-2 shadow-xl shadow-coconut-700/20 backdrop-blur dark:border-husk-50 dark:bg-husk-200/95">
        <span className="px-1 text-xs font-medium text-coconut-600 tabular-nums dark:text-sand-200">
          {count > 0 ? `${count} selected` : 'Rows removed'}
        </span>

        {count > 0 && (
          <>
            {showBinderActions && (
              <>
                <BulkSaveButton kind="want" cards={cards} onClear={onClear} onError={setError} />
                <BulkSaveButton kind="own" cards={cards} onClear={onClear} onError={setError} />

                <span className="h-5 w-px bg-sand-300 dark:bg-husk-100" aria-hidden />
              </>
            )}

            {retagOpen ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitRetag()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setRetagOpen(false)
                      setTag('')
                    }
                  }}
                  placeholder="tag…"
                  aria-label="New tag for selected rows"
                  className="w-24 rounded border border-sand-300 bg-coconut-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-400 dark:border-husk-100 dark:bg-husk-100 dark:text-sand-50"
                />
                <button
                  type="button"
                  onClick={submitRetag}
                  className="rounded bg-palm-500 px-2 py-1 text-[11px] font-medium text-coconut-50 hover:bg-palm-600 dark:text-husk-300"
                >
                  Set
                </button>
              </div>
            ) : (
              <BarButton onClick={() => setRetagOpen(true)} icon={<Tags size={13} />} label="Retag" />
            )}

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-coconut-600 hover:bg-sand-200 dark:text-sand-200 dark:hover:bg-husk-100"
                >
                  {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  Export
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="center"
                  sideOffset={6}
                  className="z-50 min-w-[180px] rounded-md border border-sand-300 bg-sand-50 p-1 shadow-lg dark:border-husk-50 dark:bg-husk-200"
                >
                  <DropdownMenu.Label className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
                    Export {count} selected
                  </DropdownMenu.Label>
                  {EXPORT_FORMATS.map((f) => (
                    <DropdownMenu.Item
                      key={f.format}
                      onSelect={() => void handleExport(f.format)}
                      className="flex cursor-pointer items-center rounded px-2 py-1.5 text-sm text-coconut-700 outline-none data-[highlighted]:bg-sand-200 dark:text-sand-50 dark:data-[highlighted]:bg-husk-100"
                    >
                      {f.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <BarButton
              onClick={onDelete}
              icon={<Trash2 size={13} />}
              label="Delete"
              tone="danger"
            />
          </>
        )}

        {canUndo && (
          <BarButton onClick={onUndo} icon={<RotateCcw size={13} />} label="Undo" />
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

function BarButton({
  onClick,
  icon,
  label,
  tone = 'default',
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
        tone === 'danger'
          ? 'text-ember-600 hover:bg-ember-500/10 dark:text-ember-300'
          : 'text-coconut-600 hover:bg-sand-200 dark:text-sand-200 dark:hover:bg-husk-100'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

/** One-tap bulk Want / Own — the multi-select mirror of the inline quick
 * actions (#761, #781). Writes every selected matched card to the user's
 * default wishlist (`want`) or collection (`own`) via the idempotent
 * default-targeting card actions; organizing into a specific binder is the
 * separate picker flow (#762). Shares the quick-action tones so the two
 * surfaces read identically. */
function BulkSaveButton({
  kind,
  cards,
  onClear,
  onError,
}: {
  kind: 'want' | 'own'
  cards: Record<string, unknown>[]
  onClear: () => void
  onError: (msg: string | null) => void
}) {
  const collections = useCollections()
  const wishlists = useWishlists()
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)

  const own = kind === 'own'
  const empty = cards.length === 0
  const Icon = own ? Book : Footprints

  async function run() {
    setBusy(true)
    onError(null)
    try {
      await Promise.all(cards.map((card) => (own ? ownCard(card) : wantCard(card))))
      // Bust the shared ownership cache, then refresh the affected library
      // cache so binder counts / insights don't go stale — the raw card
      // actions don't touch the summary caches the old picker's bulkAdd did
      // (#781 review).
      invalidateOwnership()
      await (own ? collections.refresh() : wishlists.refresh())
      setAdded(true)
      setTimeout(() => {
        setAdded(false)
        onClear()
      }, 700)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={empty || busy}
      title={empty ? 'Select at least one matched card' : undefined}
      aria-label={own ? 'Own selected cards' : 'Want selected cards'}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-40 ${
        QUICK_ACTION_TONES[own ? 'palm' : 'sun'].idle
      }`}
    >
      {busy ? (
        <Loader2 size={13} className="animate-spin" />
      ) : added ? (
        <Check size={13} />
      ) : (
        <Icon size={13} />
      )}
      {own ? 'Own' : 'Want'}
    </button>
  )
}
