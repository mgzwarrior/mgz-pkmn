/**
 * WishlistDetail — the detail view for a wishlist (#504). Opens from a
 * chasing row in [LibraryBindersTab](./LibraryBindersTab.tsx).
 *
 * A wishlist is the chase board: cards you're hunting. This modal lists each
 * item with a "got it" affordance that promotes it into a collection
 * (`POST /wishlists/{id}/items/{item_id}/promote`) — the moment a chase
 * becomes ownership. Acquired items aren't deleted: they sink to the bottom,
 * struck through, so the want-list keeps doubling as a show retrospective.
 */
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Heart, ImageOff, Loader2, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  fetchWishlist,
  promoteWishlistItem,
  type WishlistItem,
  type WishlistSummary,
} from '../api/client'
import { invalidateOwnership } from './useCardOwnership'
import { useCollections } from './useCollections'

interface Props {
  wishlist: WishlistSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function cardImage(item: WishlistItem): string | undefined {
  if (item.card_image_url) return item.card_image_url
  const images = item.card.images as { small?: string; large?: string } | undefined
  return images?.small ?? images?.large
}

function cardLabel(item: WishlistItem): string {
  return item.card_name ?? (item.card.name as string | undefined) ?? 'Unknown card'
}

function cardRef(item: WishlistItem): string {
  return `${item.card_set_id ?? ''}${item.card_number ? `-${item.card_number}` : ''}`
}

/** Per-item "got it" → collection picker. Collections come back most-recent
 * first from the API, so the dropdown already shows recents at the top. */
function GotItPicker({
  onPromote,
  busy,
}: {
  onPromote: (collectionId: number) => Promise<void>
  busy: boolean
}) {
  const { collections, loading, error, create } = useCollections()
  const [open, setOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function handleCreateAndPromote() {
    const name = newName.trim()
    if (!name) return
    setSubmitError(null)
    try {
      const created = await create(name)
      await onPromote(created.id)
      setNewName('')
      setNewOpen(false)
      setOpen(false)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1 rounded bg-palm-500 px-2 py-1 text-[11px] font-medium text-coconut-50 hover:bg-palm-600 disabled:opacity-50 dark:text-husk-300"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Got it
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-[60] w-56 rounded-md border border-sand-300 bg-sand-50 p-1 shadow-lg dark:border-husk-50 dark:bg-husk-200"
        >
          <DropdownMenu.Label className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
            Add to collection
          </DropdownMenu.Label>
          {loading && (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-coconut-400 dark:text-sand-300">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          )}
          {error && (
            <div className="px-2 py-2 text-xs text-sun-600 dark:text-sun-300">{error}</div>
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
                void onPromote(c.id).then(() => setOpen(false))
              }}
              className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm text-coconut-700 outline-none hover:bg-sand-200 dark:text-sand-50 dark:hover:bg-husk-100"
            >
              <span className="truncate">{c.name}</span>
              <span className="text-xs text-coconut-400 dark:text-sand-300">{c.item_count}</span>
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
                    void handleCreateAndPromote()
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
                onClick={() => void handleCreateAndPromote()}
                disabled={!newName.trim()}
                className="rounded bg-palm-400 px-2 py-1 text-xs font-medium text-sand-50 hover:bg-palm-300 disabled:opacity-50 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200"
              >
                Save
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
            <div className="px-2 py-1 text-xs text-sun-600 dark:text-sun-300">{submitError}</div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ItemRow({
  item,
  onPromote,
}: {
  item: WishlistItem
  onPromote: (itemId: number, collectionId: number) => Promise<void>
}) {
  const [broken, setBroken] = useState(false)
  const [busy, setBusy] = useState(false)
  const acquired = item.acquired_at != null
  const img = cardImage(item)

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-sand-200 dark:bg-husk-100">
        {img && !broken ? (
          <img
            src={img}
            alt={cardLabel(item)}
            loading="lazy"
            onError={() => setBroken(true)}
            className={`h-full w-full object-contain ${acquired ? 'opacity-50' : ''}`}
          />
        ) : (
          <ImageOff size={14} className="text-coconut-400 dark:text-sand-300" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-xs font-medium ${
            acquired
              ? 'text-coconut-400 line-through dark:text-sand-300'
              : 'text-coconut-700 dark:text-sand-50'
          }`}
        >
          {cardLabel(item)}
        </div>
        <div className="truncate text-[11px] text-coconut-400 dark:text-sand-300">
          {cardRef(item)}
          {item.card_rarity ? ` · ${item.card_rarity}` : ''}
        </div>
      </div>
      {acquired ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-palm-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-palm-700 dark:bg-husk-100 dark:text-palm-300">
          <Check size={10} /> Got it
        </span>
      ) : (
        <GotItPicker
          busy={busy}
          onPromote={async (collectionId) => {
            setBusy(true)
            try {
              await onPromote(item.id, collectionId)
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </li>
  )
}

export function WishlistDetail({ wishlist, open, onOpenChange }: Props) {
  const collections = useCollections()
  const [items, setItems] = useState<WishlistItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !wishlist) return
    let cancelled = false
    const load = async () => {
      setItems([])
      setError(null)
      setLoading(true)
      try {
        const full = await fetchWishlist(wishlist.id)
        if (!cancelled) setItems(full.items)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, wishlist])

  async function handlePromote(itemId: number, collectionId: number) {
    if (!wishlist) return
    const res = await promoteWishlistItem(wishlist.id, itemId, { collectionId })
    // Swap the acquired row in place — it stays in the list, struck through.
    setItems((prev) => prev.map((i) => (i.id === itemId ? res.wishlist_item : i)))
    // The card is now owned: refresh the collection counts and drop the
    // cross-surface ownership badge cache (#576).
    void collections.refresh()
    invalidateOwnership()
  }

  // Outstanding chases first, acquired ones sunk to the bottom.
  const sorted = [...items].sort((a, b) => {
    const aDone = a.acquired_at != null ? 1 : 0
    const bDone = b.acquired_at != null ? 1 : 0
    return aDone - bDone
  })
  const outstanding = items.filter((i) => i.acquired_at == null).length

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200">
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <div className="flex min-w-0 items-center gap-2">
              <Heart size={18} className="shrink-0 text-coconut-600 dark:text-sand-200" />
              <Dialog.Title className="truncate text-lg font-semibold text-coconut-700 dark:text-sand-50">
                {wishlist?.name ?? 'Wishlist'}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-1 text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            Cards on this want-list. Mark one &ldquo;got it&rdquo; to move it into a
            collection.
          </Dialog.Description>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-coconut-400 dark:text-sand-300">
                <Loader2 size={14} className="animate-spin" />
                Loading cards…
              </div>
            ) : error ? (
              <div role="alert" className="text-xs text-sun-600 dark:text-sun-300">
                {error}
              </div>
            ) : items.length === 0 ? (
              <p className="text-xs text-coconut-500 dark:text-sand-300">
                This want-list is empty. Click the heart icon on a matched row to add a
                chase.
              </p>
            ) : (
              <>
                <div className="mb-2 text-[11px] text-coconut-400 dark:text-sand-300">
                  {outstanding} still chasing · {items.length - outstanding} landed
                </div>
                <ul className="divide-y divide-sand-200 dark:divide-husk-100">
                  {sorted.map((item) => (
                    <ItemRow key={item.id} item={item} onPromote={handlePromote} />
                  ))}
                </ul>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
