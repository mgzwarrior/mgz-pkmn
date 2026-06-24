/**
 * AddToListPicker — the "organize later" half of the capture-first model
 * (#762, ADR-0027). The one-tap Want / Own toggles write to your *default*
 * list; this is the light, optional secondary step that puts the same card on
 * a *specific* named collection or want-list — without the old up-front picker
 * gate returning.
 *
 * Lists the card isn't already in are offered (the derived occupancy comes from
 * the shared ownership lookup, so a list drops out the moment the card lands in
 * it). Dynamic (smart) collections are rule-resolved and can't be hand-added,
 * so they're filtered out. Adding goes through the cache-aware hooks, which
 * bump the item counts and bust the ownership badge so every surface re-reads.
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Book, Footprints, ListPlus, Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import type { CardOwnership } from '../api/client'
import { useCollections } from './useCollections'
import { useWishlists } from './useWishlists'

type Creating = 'collection' | 'wishlist' | null

export function AddToListPicker({
  card,
  ownership,
}: {
  card: Record<string, unknown>
  ownership: CardOwnership | null | undefined
}) {
  const collections = useCollections()
  const wishlists = useWishlists()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState<Creating>(null)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Drop lists the card already sits in (from the shared occupancy) and
  // dynamic collections, whose membership is rule-resolved (the items API
  // 409s on a hand-add).
  const inCollections = new Set((ownership?.collections ?? []).map((c) => c.id))
  const inWishlists = new Set((ownership?.wishlists ?? []).map((w) => w.id))
  const addableCollections = collections.collections.filter(
    (c) => c.kind !== 'dynamic' && !inCollections.has(c.id),
  )
  const addableWishlists = wishlists.wishlists.filter((w) => !inWishlists.has(w.id))

  function reset() {
    setCreating(null)
    setNewName('')
    setError(null)
  }

  async function addToCollection(id: number) {
    setBusy(true)
    setError(null)
    try {
      await collections.addCard(id, card)
      setOpen(false)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function addToWishlist(id: number) {
    setBusy(true)
    setError(null)
    try {
      await wishlists.addCard(id, card)
      setOpen(false)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function createAndAdd() {
    const name = newName.trim()
    if (!name || !creating) return
    setBusy(true)
    setError(null)
    try {
      if (creating === 'collection') {
        const created = await collections.create(name)
        await collections.addCard(created.id, card)
      } else {
        const created = await wishlists.create(name)
        await wishlists.addCard(created.id, card)
      }
      setOpen(false)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-coconut-500 hover:bg-sand-200 disabled:opacity-50 dark:text-sand-300 dark:hover:bg-husk-100"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ListPlus size={13} />}
          Add to a list…
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-[60] w-60 rounded-md border border-sand-300 bg-sand-50 p-1 shadow-lg dark:border-husk-50 dark:bg-husk-200"
        >
          <ListSection
            label="Add to collection"
            icon={<Book size={12} />}
            items={addableCollections}
            emptyHint="In every collection already."
            onPick={addToCollection}
            creating={creating === 'collection'}
            onStartCreate={() => {
              setCreating('collection')
              setNewName('')
            }}
            createLabel="New collection…"
            placeholder="Collection name"
            newName={newName}
            onNewName={setNewName}
            onSubmit={createAndAdd}
            onCancel={reset}
            busy={busy}
          />
          <DropdownMenu.Separator className="my-1 h-px bg-sand-200 dark:bg-husk-100" />
          <ListSection
            label="Add to want-list"
            icon={<Footprints size={12} />}
            items={addableWishlists}
            emptyHint="On every want-list already."
            onPick={addToWishlist}
            creating={creating === 'wishlist'}
            onStartCreate={() => {
              setCreating('wishlist')
              setNewName('')
            }}
            createLabel="New want-list…"
            placeholder="Want-list name"
            newName={newName}
            onNewName={setNewName}
            onSubmit={createAndAdd}
            onCancel={reset}
            busy={busy}
          />
          {error && (
            <div role="alert" className="px-2 py-1 text-[11px] text-ember-500 dark:text-ember-300">
              {error}
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ListSection({
  label,
  icon,
  items,
  emptyHint,
  onPick,
  creating,
  onStartCreate,
  createLabel,
  placeholder,
  newName,
  onNewName,
  onSubmit,
  onCancel,
  busy,
}: {
  label: string
  icon: React.ReactNode
  items: { id: number; name: string; item_count: number }[]
  emptyHint: string
  onPick: (id: number) => void
  creating: boolean
  onStartCreate: () => void
  createLabel: string
  placeholder: string
  newName: string
  onNewName: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <>
      <DropdownMenu.Label className="flex items-center gap-1 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
        {icon}
        {label}
      </DropdownMenu.Label>
      {items.length === 0 && !creating && (
        <div className="px-2 py-1 text-[11px] text-coconut-400 dark:text-sand-300">{emptyHint}</div>
      )}
      {items.map((item) => (
        <DropdownMenu.Item
          key={item.id}
          disabled={busy}
          onSelect={(e) => {
            e.preventDefault()
            onPick(item.id)
          }}
          className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm text-coconut-700 outline-none data-[highlighted]:bg-sand-200 dark:text-sand-50 dark:data-[highlighted]:bg-husk-100"
        >
          <span className="truncate">{item.name}</span>
          <span className="text-xs text-coconut-400 dark:text-sand-300">{item.item_count}</span>
        </DropdownMenu.Item>
      ))}
      {creating ? (
        <div className="flex items-center gap-1 px-1 py-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => onNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSubmit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="flex-1 rounded border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-100 dark:text-sand-50"
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !newName.trim()}
            className="rounded bg-palm-500 px-2 py-1 text-xs font-medium text-coconut-50 hover:bg-palm-600 disabled:opacity-50 dark:text-husk-300"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
          </button>
        </div>
      ) : (
        <DropdownMenu.Item
          disabled={busy}
          onSelect={(e) => {
            e.preventDefault()
            onStartCreate()
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-sm text-palm-600 outline-none data-[highlighted]:bg-sand-200 dark:text-palm-300 dark:data-[highlighted]:bg-husk-100"
        >
          <Plus size={13} /> {createLabel}
        </DropdownMenu.Item>
      )}
    </>
  )
}
