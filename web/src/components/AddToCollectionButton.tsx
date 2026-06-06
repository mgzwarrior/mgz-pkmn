/**
 * AddToCollectionButton — per-row "+ Save to collection" picker.
 *
 * A compact icon-button on each matched ResultsTable row. Opens a Radix
 * dropdown listing the user's existing collections plus an inline
 * "+ New collection…" form. Clicking a collection POSTs the row's
 * `card_json` to `/api/v1/collections/{id}/items` and shows a brief
 * "Added" confirmation before closing.
 */
import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Bookmark, Check, Loader2, Plus } from 'lucide-react'
import { useCollections } from './useCollections'

interface Props {
  card: Record<string, unknown>
}

export function AddToCollectionButton({ card }: Props) {
  const { collections, loading, error, create, addCard } = useCollections()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [justAdded, setJustAdded] = useState<number | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function handleAdd(collectionId: number) {
    setBusyId(collectionId)
    setSubmitError(null)
    try {
      await addCard(collectionId, card)
      setJustAdded(collectionId)
      setTimeout(() => {
        setJustAdded(null)
        setOpen(false)
      }, 700)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function handleCreateAndAdd() {
    const name = newName.trim()
    if (!name) return
    setBusyId(-1)
    setSubmitError(null)
    try {
      const created = await create(name)
      await addCard(created.id, card)
      setJustAdded(created.id)
      setNewName('')
      setNewOpen(false)
      setTimeout(() => {
        setJustAdded(null)
        setOpen(false)
      }, 700)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Save to collection"
          title="Save to collection"
          className="rounded p-1 text-coconut-400 hover:text-palm-500 dark:text-sand-300 dark:hover:text-sun-300 transition-colors"
        >
          <Bookmark size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 w-56 rounded-md border border-sand-300 bg-sand-50 p-1 shadow-lg dark:border-husk-50 dark:bg-husk-200"
        >
          <DropdownMenu.Label className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
            Save to collection
          </DropdownMenu.Label>
          {loading && (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-coconut-400 dark:text-sand-300">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          )}
          {error && (
            <div className="px-2 py-2 text-xs text-sun-600 dark:text-sun-300">
              {error}
            </div>
          )}
          {!loading && !error && collections.length === 0 && (
            <div className="px-2 py-2 text-xs text-coconut-400 dark:text-sand-300">
              No collections yet.
            </div>
          )}
          {collections.map((c) => (
            <DropdownMenu.Item
              key={c.id}
              onSelect={(e) => {
                e.preventDefault()
                void handleAdd(c.id)
              }}
              className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm text-coconut-700 outline-none hover:bg-sand-200 dark:text-sand-50 dark:hover:bg-husk-100"
            >
              <span className="truncate">{c.name}</span>
              {busyId === c.id ? (
                <Loader2 size={12} className="animate-spin text-coconut-400 dark:text-sand-300" />
              ) : justAdded === c.id ? (
                <Check size={12} className="text-palm-500 dark:text-sun-300" />
              ) : (
                <span className="text-xs text-coconut-400 dark:text-sand-300">
                  {c.item_count}
                </span>
              )}
            </DropdownMenu.Item>
          ))}
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
                    void handleCreateAndAdd()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setNewOpen(false)
                    setNewName('')
                  }
                }}
                placeholder="Collection name"
                className="flex-1 rounded border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-100 dark:text-sand-50 dark:placeholder:text-sand-500 dark:focus:ring-sun-300"
                aria-label="New collection name"
              />
              <button
                type="button"
                onClick={() => void handleCreateAndAdd()}
                disabled={busyId === -1 || !newName.trim()}
                className="rounded bg-palm-400 px-2 py-1 text-xs font-medium text-sand-50 hover:bg-palm-300 disabled:opacity-50 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200"
              >
                {busyId === -1 ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
              </button>
            </div>
          ) : (
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault()
                setNewOpen(true)
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-sm text-palm-500 outline-none hover:bg-sand-200 dark:text-sun-300 dark:hover:bg-husk-100"
            >
              <Plus size={13} /> New collection…
            </DropdownMenu.Item>
          )}
          {submitError && (
            <div className="px-2 py-1 text-xs text-sun-600 dark:text-sun-300">
              {submitError}
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
