/**
 * BulkActionBar — floating action bar for the results-table multi-select
 * (#268). Slides up from the bottom when ≥1 row is selected and offers:
 *
 * - **Binder actions** — add the selected matched cards to a binder as
 *   *owned* (a collection) or *chasing* (a want-list), backed by the bulk
 *   endpoints (`bulkAdd` on [useCollections](./useCollections.ts) /
 *   [useWishlists](./useWishlists.ts)). A picker lists existing binders and
 *   can spin up a new one inline.
 * - **View actions** — drop the selected rows from the current results
 *   view, retag them (the export source tag), or export only the selection.
 *
 * Delete and retag mutate the ephemeral results rows in the store via the
 * parent's callbacks; the parent keeps the removed rows so Undo can restore
 * the last delete. Binder/Export tones follow the owned=palm / chasing=sun
 * read (#576).
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  BookOpen,
  Check,
  Download,
  Heart,
  Loader2,
  Plus,
  RotateCcw,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { exportFile, type CollectionSummary, type WishlistSummary } from '../api/client'
import { useAppStore } from '../store'
import type { ExportFormat, Row } from '../types'
import { useCollections } from './useCollections'
import { useWishlists } from './useWishlists'

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
                <BinderPicker kind="owned" cards={cards} onClear={onClear} onError={setError} />
                <BinderPicker kind="chasing" cards={cards} onClear={onClear} onError={setError} />

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

/** Add-to-binder picker, parameterised by owned (collection) vs chasing
 * (want-list). Lists the user's binders of that kind and can create a new
 * one inline, then bulk-adds the selected matched cards. */
function BinderPicker({
  kind,
  cards,
  onClear,
  onError,
}: {
  kind: 'owned' | 'chasing'
  cards: Record<string, unknown>[]
  onClear: () => void
  onError: (msg: string | null) => void
}) {
  const collections = useCollections()
  const wishlists = useWishlists()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [justAdded, setJustAdded] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')

  const owned = kind === 'owned'
  // Dynamic collections are rule-defined — you can't hand-add to them, so
  // keep only the hand-curated kinds (manual / set / binder) in the picker.
  const binders: (CollectionSummary | WishlistSummary)[] = owned
    ? collections.collections.filter(
        (c) => !('kind' in c) || c.kind === 'manual' || c.kind === 'set' || c.kind === 'binder',
      )
    : wishlists.wishlists
  const disabled = cards.length === 0

  async function addTo(binderId: number) {
    setBusyId(binderId)
    onError(null)
    try {
      if (owned) await collections.bulkAdd(binderId, cards, { addedVia: 'bulk' })
      else await wishlists.bulkAdd(binderId, cards)
      setJustAdded(true)
      setTimeout(() => {
        setJustAdded(false)
        setOpen(false)
        onClear()
      }, 700)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function createAndAdd() {
    const name = newName.trim()
    if (!name) return
    setBusyId(-1)
    onError(null)
    try {
      const created = owned
        ? await collections.create(name)
        : await wishlists.create(name)
      if (owned) await collections.bulkAdd(created.id, cards, { addedVia: 'bulk' })
      else await wishlists.bulkAdd(created.id, cards)
      setNewName('')
      setNewOpen(false)
      setJustAdded(true)
      setTimeout(() => {
        setJustAdded(false)
        setOpen(false)
        onClear()
      }, 700)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? 'Select at least one matched card' : undefined}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 ${
            owned
              ? 'text-palm-600 hover:bg-palm-500/10 dark:text-palm-200'
              : 'text-husk-500 hover:bg-sun-400/15 dark:text-sun-200'
          }`}
        >
          {owned ? <BookOpen size={13} /> : <Heart size={13} />}
          {owned ? 'Add as owned' : 'Add as chasing'}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="center"
          sideOffset={6}
          className="z-50 w-56 rounded-md border border-sand-300 bg-sand-50 p-1 shadow-lg dark:border-husk-50 dark:bg-husk-200"
        >
          <DropdownMenu.Label className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
            {owned ? 'Add to collection' : 'Add to want-list'}
          </DropdownMenu.Label>
          {justAdded && (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-palm-600 dark:text-palm-200">
              <Check size={12} /> Added {cards.length} {cards.length === 1 ? 'card' : 'cards'}
            </div>
          )}
          {!justAdded && binders.length === 0 && (
            <div className="px-2 py-2 text-xs text-coconut-400 dark:text-sand-300">
              {owned ? 'No collections yet.' : 'No want-lists yet.'}
            </div>
          )}
          {!justAdded &&
            binders.map((b) => (
              <DropdownMenu.Item
                key={b.id}
                onSelect={(e) => {
                  e.preventDefault()
                  void addTo(b.id)
                }}
                className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm text-coconut-700 outline-none data-[highlighted]:bg-sand-200 dark:text-sand-50 dark:data-[highlighted]:bg-husk-100"
              >
                <span className="truncate">{b.name}</span>
                {busyId === b.id ? (
                  <Loader2 size={12} className="animate-spin text-coconut-400 dark:text-sand-300" />
                ) : (
                  <span className="text-xs text-coconut-400 dark:text-sand-300">{b.item_count}</span>
                )}
              </DropdownMenu.Item>
            ))}
          {!justAdded && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-sand-200 dark:bg-husk-100" />
              {newOpen ? (
                <div className="flex items-center gap-1 px-1 py-1">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void createAndAdd()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setNewOpen(false)
                        setNewName('')
                      }
                    }}
                    placeholder={owned ? 'Collection name' : 'Want-list name'}
                    aria-label={owned ? 'New collection name' : 'New want-list name'}
                    className="flex-1 rounded border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-100 dark:text-sand-50"
                  />
                  <button
                    type="button"
                    onClick={() => void createAndAdd()}
                    disabled={busyId === -1 || !newName.trim()}
                    className="rounded bg-palm-400 px-2 py-1 text-xs font-medium text-sand-50 hover:bg-palm-300 disabled:opacity-50 dark:bg-sun-300 dark:text-husk-500"
                  >
                    {busyId === -1 ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
                  </button>
                </div>
              ) : (
                <DropdownMenu.Item
                  onSelect={(e) => {
                    e.preventDefault()
                    setNewOpen(true)
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-sm text-palm-500 outline-none data-[highlighted]:bg-sand-200 dark:text-sun-300 dark:data-[highlighted]:bg-husk-100"
                >
                  <Plus size={13} /> {owned ? 'New collection…' : 'New want-list…'}
                </DropdownMenu.Item>
              )}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
