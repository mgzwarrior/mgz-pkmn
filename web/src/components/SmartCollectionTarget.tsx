/**
 * SmartCollectionTarget — the detail view for a catalog-scope smart
 * collection (#631). Opens from a row in [LibraryCollectionsTab](./LibraryCollectionsTab.tsx).
 *
 * A catalog-scope smart collection is a goal, not a bucket: its membership
 * is the full set of cards matching the rule (resolved from the catalog via
 * `GET /collections/{id}/target`), with the user's ownership overlaid. The
 * modal shows an `owned / total` progress bar, the cards you already have,
 * and the missing ones as chase candidates — with one button to push every
 * un-owned match onto a want-list (`POST /collections/{id}/chase`).
 *
 * Chasing is idempotent: the first click creates a want-list named after the
 * collection and remembers its id, so re-clicking adds only newly-missing
 * cards to the same list rather than spawning duplicates.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { ImageOff, Loader2, Plus, Target, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  chaseCollection,
  fetchCollectionTarget,
  type CollectionSummary,
  type CollectionTarget,
  type TargetCard,
} from '../api/client'
import { useAppStore } from '../store'
import { useWishlists } from './useWishlists'

interface Props {
  collection: CollectionSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function cardImage(card: Record<string, unknown>): string | undefined {
  const images = card.images as { small?: string; large?: string } | undefined
  return images?.small ?? images?.large
}

function cardName(card: Record<string, unknown>): string {
  return (card.name as string | undefined) ?? 'Unknown card'
}

function CardTile({ tc }: { tc: TargetCard }) {
  const [broken, setBroken] = useState(false)
  const img = cardImage(tc.card)
  return (
    <div
      className={`rounded-md border p-1.5 ${
        tc.owned
          ? 'border-palm-200 bg-palm-50 dark:border-husk-100 dark:bg-husk-100'
          : 'border-sand-200 bg-sand-50 opacity-90 dark:border-husk-100 dark:bg-husk-200'
      }`}
    >
      <div className="mb-1 flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-sand-200 dark:bg-husk-100">
        {img && !broken ? (
          <img
            src={img}
            alt={cardName(tc.card)}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImageOff size={16} className="text-coconut-400 dark:text-sand-300" />
        )}
      </div>
      <div className="truncate text-[11px] font-medium text-coconut-700 dark:text-sand-50">
        {cardName(tc.card)}
      </div>
      <div className="truncate text-[10px] text-coconut-400 dark:text-sand-300">
        {tc.card_set_id}
        {tc.card_number ? `-${tc.card_number}` : ''}
        {tc.owned && tc.owned_quantity > 1 ? ` · ${tc.owned_quantity}x` : ''}
      </div>
    </div>
  )
}

export function SmartCollectionTarget({ collection, open, onOpenChange }: Props) {
  const apiKey = useAppStore((s) => s.settings.apiKey)
  const wishlists = useWishlists()

  const [target, setTarget] = useState<CollectionTarget | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chasing, setChasing] = useState(false)
  const [chaseMsg, setChaseMsg] = useState<string | null>(null)
  // Remember the want-list created on the first chase so repeat clicks top up
  // the same list instead of creating a new one each time.
  const chaseWishlistId = useRef<number | null>(null)

  useEffect(() => {
    if (!open || !collection) return
    let cancelled = false
    const load = async () => {
      setTarget(null)
      setError(null)
      setChaseMsg(null)
      chaseWishlistId.current = null
      setLoading(true)
      try {
        const resolved = await fetchCollectionTarget(collection.id, apiKey || undefined)
        if (!cancelled) setTarget(resolved)
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
  }, [open, collection, apiKey])

  async function handleChase() {
    if (!collection || !target) return
    setChasing(true)
    setChaseMsg(null)
    try {
      const res = await chaseCollection(
        collection.id,
        chaseWishlistId.current
          ? { wishlistId: chaseWishlistId.current }
          : { wishlistName: collection.name },
        apiKey || undefined,
      )
      chaseWishlistId.current = res.wishlist_id
      void wishlists.refresh()
      setChaseMsg(
        res.added > 0
          ? `Added ${res.added} to your want-list.`
          : res.total_missing === 0
            ? 'You already own every card here.'
            : 'All missing cards are already on your want-list.',
      )
    } catch (e) {
      setChaseMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setChasing(false)
    }
  }

  const owned = target ? target.cards.filter((c) => c.owned) : []
  const missing = target ? target.cards.filter((c) => !c.owned) : []
  const pct = target && target.total > 0 ? Math.round((target.owned_count / target.total) * 100) : 0

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200">
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <div className="flex min-w-0 items-center gap-2">
              <Target size={18} className="shrink-0 text-coconut-600 dark:text-sand-200" />
              <Dialog.Title className="truncate text-lg font-semibold text-coconut-700 dark:text-sand-50">
                {collection?.name ?? 'Smart collection'}
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
            Cards matching this smart collection&apos;s rule, with the ones you
            own and the ones still to chase.
          </Dialog.Description>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-coconut-400 dark:text-sand-300">
                <Loader2 size={14} className="animate-spin" />
                Resolving from catalog…
              </div>
            ) : error ? (
              <div role="alert" className="text-xs text-sun-600 dark:text-sun-300">
                {error}
              </div>
            ) : target ? (
              <>
                <div className="mb-4">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-coconut-700 dark:text-sand-50">
                      {target.owned_count}
                    </span>
                    <span className="text-xs text-coconut-500 dark:text-sand-300">
                      of {target.total} owned · {missing.length} to chase
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-sand-200 dark:bg-husk-100">
                    <div
                      className="h-full rounded-full bg-palm-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-coconut-400 dark:text-sand-300">
                    {pct}% complete
                  </div>
                </div>

                {missing.length > 0 && (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleChase}
                      disabled={chasing}
                      className="inline-flex items-center gap-1.5 rounded bg-palm-500 px-3 py-1.5 text-xs font-medium text-coconut-50 hover:bg-palm-600 disabled:opacity-50 dark:text-husk-300"
                    >
                      {chasing ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Plus size={13} />
                      )}
                      Add {missing.length} missing to want-list
                    </button>
                    {chaseMsg && (
                      <span className="text-[11px] text-coconut-500 dark:text-sand-300">
                        {chaseMsg}
                      </span>
                    )}
                  </div>
                )}

                {owned.length > 0 && (
                  <section className="mb-4">
                    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
                      Owned ({owned.length})
                    </h3>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
                      {owned.map((tc) => (
                        <CardTile key={`${tc.card_set_id}-${tc.card_number}`} tc={tc} />
                      ))}
                    </div>
                  </section>
                )}

                {missing.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
                      Missing — chase candidates ({missing.length})
                    </h3>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
                      {missing.map((tc) => (
                        <CardTile key={`${tc.card_set_id}-${tc.card_number}`} tc={tc} />
                      ))}
                    </div>
                  </section>
                )}

                {target.total === 0 && (
                  <p className="text-xs text-coconut-500 dark:text-sand-300">
                    No catalog cards match this rule yet. Try a broader rule.
                  </p>
                )}
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
