/**
 * AddToWishlistButton — per-row "+ Save to wishlist" picker.
 *
 * A compact heart-icon button on each matched ResultsTable row. Opens a
 * Radix dropdown listing the user's existing wishlists plus an inline
 * "+ New wishlist…" form with an optional `max_price` cap field. The
 * cap is persisted on the wishlist item even though alerting is future
 * work (per ADR-0013 / #245).
 */
import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Footprints, Loader2, Plus } from 'lucide-react'
import { useWishlists } from './useWishlists'

interface Props {
  card: Record<string, unknown>
  variant?: 'icon' | 'primary'
}

export function AddToWishlistButton({ card, variant = 'icon' }: Props) {
  const { wishlists, loading, error, create, addCard } = useWishlists()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [justAdded, setJustAdded] = useState<number | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [capInput, setCapInput] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const isPrimary = variant === 'primary'

  function parseCap(): number | null {
    const trimmed = capInput.trim()
    if (!trimmed) return null
    const value = Number(trimmed)
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  async function handleAdd(wishlistId: number) {
    setBusyId(wishlistId)
    setSubmitError(null)
    try {
      await addCard(wishlistId, card)
      setJustAdded(wishlistId)
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
      await addCard(created.id, card, { maxPrice: parseCap() })
      setJustAdded(created.id)
      setNewName('')
      setCapInput('')
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
          aria-label={isPrimary ? 'Add as chasing' : 'Save to wishlist'}
          title={isPrimary ? 'Add as chasing' : 'Save to wishlist'}
          className={
            isPrimary
              ? 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-sun-300 px-3 py-2 text-sm font-semibold text-husk-500 shadow-sm transition-colors hover:bg-sun-200 focus:outline-none focus:ring-2 focus:ring-sun-300 disabled:opacity-50 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200'
              : 'rounded p-1 text-coconut-400 hover:text-palm-500 dark:text-sand-300 dark:hover:text-sun-300 transition-colors'
          }
        >
          <Footprints size={isPrimary ? 16 : 13} aria-hidden />
          {isPrimary && <span>Add as chasing</span>}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 w-64 rounded-md border border-sand-300 bg-sand-50 p-1 shadow-lg dark:border-husk-50 dark:bg-husk-200"
        >
          <DropdownMenu.Label className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
            Save to wishlist
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
          {!loading && !error && wishlists.length === 0 && (
            <div className="px-2 py-2 text-xs text-coconut-400 dark:text-sand-300">
              No wishlists yet.
            </div>
          )}
          {wishlists.map((w) => (
            <DropdownMenu.Item
              key={w.id}
              onSelect={(e) => {
                e.preventDefault()
                void handleAdd(w.id)
              }}
              className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm text-coconut-700 outline-none hover:bg-sand-200 dark:text-sand-50 dark:hover:bg-husk-100"
            >
              <span className="truncate">{w.name}</span>
              {busyId === w.id ? (
                <Loader2 size={12} className="animate-spin text-coconut-400 dark:text-sand-300" />
              ) : justAdded === w.id ? (
                <Check size={12} className="text-palm-500 dark:text-sun-300" />
              ) : (
                <span className="text-xs text-coconut-400 dark:text-sand-300">
                  {w.item_count}
                </span>
              )}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-sand-200 dark:bg-husk-100" />
          {newOpen ? (
            <div className="flex flex-col gap-1 px-1 py-1">
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
                    setCapInput('')
                  }
                }}
                placeholder="Wishlist name"
                className="rounded border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-100 dark:text-sand-50 dark:placeholder:text-sand-500 dark:focus:ring-sun-300"
                aria-label="New wishlist name"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleCreateAndAdd()
                    }
                  }}
                  placeholder="Cap (optional)"
                  className="flex-1 rounded border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-100 dark:text-sand-50 dark:placeholder:text-sand-500 dark:focus:ring-sun-300"
                  aria-label="Max price (optional)"
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
            </div>
          ) : (
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault()
                setNewOpen(true)
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-sm text-palm-500 outline-none hover:bg-sand-200 dark:text-sun-300 dark:hover:bg-husk-100"
            >
              <Plus size={13} /> New wishlist…
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
