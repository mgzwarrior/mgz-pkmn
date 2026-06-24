/**
 * LibraryBindersTab — unified "Binders" surface that bridges the two
 * halves of a collector's library: collections (*owned* — "I have
 * these") and want-lists (*chasing* — "I want these"). Both read as
 * binders here; a kind badge tags each row and a segmented filter
 * (All / Owned / Chasing) scopes the list.
 *
 * Collections and want-lists stay separate API resources underneath —
 * this tab composes [useCollections](./useCollections.ts) +
 * [useWishlists](./useWishlists.ts) into one interleaved, newest-first
 * list. The owned-only smart-collection inline builder and both detail
 * modals live here: [SmartCollectionTarget](./SmartCollectionTarget.tsx)
 * for catalog targets, [WishlistDetail](./WishlistDetail.tsx) for
 * want-lists.
 *
 * Owned/Chasing tone follows the design system's read and the
 * [OwnershipBadge](./OwnershipBadge.tsx) chip (#576): palm for owned,
 * sun for chasing.
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  BarChart3,
  Check,
  ChevronDown,
  FolderInput,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { downloadCollectionIdCardPdf } from '../api/client'
import type { BinderSummary, CollectionSummary, WishlistSummary } from '../api/client'
import { useAppStore } from '../store'
import { BinderModal } from './BinderModal'
import { BinderInventory } from './BinderInventory'
import { CollectionCreateDialog } from './CollectionCreateDialog'
import { CollectionDetail } from './CollectionDetail'
import { BINDER_TYPE_OPTIONS, coverSwatch } from './binderIdentity'
import { CollectionInsights } from './CollectionInsights'
import { SmartCollectionTarget } from './SmartCollectionTarget'
import { WishlistCreateDialog } from './WishlistCreateDialog'
import { WishlistDetail } from './WishlistDetail'
import { useBinders } from './useBinders'
import { useCollections } from './useCollections'
import { useWishlists } from './useWishlists'

/** Binders come in two kinds: owned (a collection) and chasing (a
 * want-list). The filter scopes the list to one kind or shows both. */
type BinderFilter = 'all' | 'owned' | 'chasing'

const FILTER_OPTIONS: { key: BinderFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'owned', label: 'Owned' },
  { key: 'chasing', label: 'Chasing' },
]

/** One row in the unified list — either an owned collection or a chasing
 * want-list. Carries `created_at` so both kinds interleave newest-first. */
type BinderRow =
  | { key: string; kind: 'owned'; created_at: string; collection: CollectionSummary }
  | { key: string; kind: 'chasing'; created_at: string; wishlist: WishlistSummary }

/** A catalog-scope smart collection is a target with progress, so it reads
 * as "target"; an owned-scope one is an inventory view ("smart"). A binder
 * renders its own identity (color / format / capacity) instead of a pill. */
function kindPill(c: CollectionSummary): string | null {
  if (c.kind === 'dynamic') return c.dynamic_scope === 'catalog' ? 'target' : 'smart'
  if (c.kind === 'set') return 'set'
  return null
}

function isCatalogTarget(c: CollectionSummary): boolean {
  return c.kind === 'dynamic' && c.dynamic_scope === 'catalog'
}

/** Empty-state copy keyed off the active filter. */
function emptyMessage(filter: BinderFilter): string {
  if (filter === 'owned')
    return "No owned binders yet. Hit New binder to make one, or click the book icon on a matched row to start a collection."
  if (filter === 'chasing')
    return "No want-lists yet. Run a lookup, then click the footprints icon on a matched row to start chasing a card."
  return "You don't have any binders yet. Hit New binder to make one, or run a lookup and click the book icon to save a card or the footprints icon to start a want-list."
}

export function LibraryBindersTab() {
  const {
    collections,
    loading: cLoading,
    error: cError,
    refresh: refreshCollections,
    remove: removeCollection,
    update: updateCollection,
  } = useCollections()
  const { binders, refresh: refreshBinders } = useBinders()
  const {
    wishlists,
    loading: wLoading,
    error: wError,
    refresh: refreshWishlists,
    remove: removeWishlist,
    file: fileWishlistApi,
  } = useWishlists()

  const [filter, setFilter] = useState<BinderFilter>('all')
  // Which name-only create dialog (New ▾ → Collection / Want-list) is open.
  const [createDialog, setCreateDialog] = useState<'collection' | 'wishlist' | null>(null)
  // The binder create/edit modal. `null` editing means create; a binder
  // means edit. `modalOpen` drives the dialog independently so a fresh
  // create starts from a clean slate.
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBinder, setEditingBinder] = useState<CollectionSummary | null>(null)
  // Bumped on each open so the modal remounts and re-seeds its form from the
  // current target (create vs. a specific binder) via its lazy initializers.
  const [modalKey, setModalKey] = useState(0)
  // The catalog-scope target collection whose detail modal is open.
  const [targetCollection, setTargetCollection] = useState<CollectionSummary | null>(null)
  // The (non-target) collection whose card-list detail modal is open.
  const [openCollection, setOpenCollection] = useState<CollectionSummary | null>(null)
  // The want-list whose detail modal is open.
  const [openWishlist, setOpenWishlist] = useState<WishlistSummary | null>(null)
  // The aggregate insights dashboard.
  const [insightsOpen, setInsightsOpen] = useState(false)

  useEffect(() => {
    void refreshCollections()
    void refreshWishlists()
  }, [refreshCollections, refreshWishlists])

  const loading = cLoading || wLoading
  const error = cError ?? wError

  function openCreate() {
    setEditingBinder(null)
    setModalKey((k) => k + 1)
    setModalOpen(true)
  }

  function openEdit(c: CollectionSummary) {
    setEditingBinder(c)
    setModalKey((k) => k + 1)
    setModalOpen(true)
  }

  // File a collection into a binder (or pass null to unfile), then refresh
  // the binder summaries so their counts stay in sync across surfaces.
  async function fileCollection(collectionId: number, binderId: number | null) {
    await updateCollection(collectionId, { binder_id: binderId })
    await refreshBinders()
  }

  // File a want-list into a binder (or null to unfile), then refresh the
  // binder summaries so their fill counts stay in sync across surfaces (#774).
  async function fileWishlist(wishlistId: number, binderId: number | null) {
    await fileWishlistApi(wishlistId, binderId)
    await refreshBinders()
  }

  // Interleave both kinds newest-first, then scope to the active filter.
  const rows: BinderRow[] = [
    ...collections.map(
      (c): BinderRow => ({ key: `c-${c.id}`, kind: 'owned', created_at: c.created_at, collection: c }),
    ),
    ...wishlists.map(
      (w): BinderRow => ({ key: `w-${w.id}`, kind: 'chasing', created_at: w.created_at, wishlist: w }),
    ),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const visible = filter === 'all' ? rows : rows.filter((r) => r.kind === filter)

  return (
    <div className="space-y-3">
      <BinderInventory />

      <div className="border-t border-sand-200 pt-3 dark:border-husk-100" />

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
          Collections &amp; want-lists
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setInsightsOpen(true)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-palm-600 hover:bg-palm-50 dark:text-palm-300 dark:hover:bg-husk-100"
          >
            <BarChart3 size={12} />
            Insights
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded bg-palm-500 px-2 py-1 text-[11px] font-medium text-coconut-50 hover:bg-palm-600 dark:text-husk-300"
              >
                <Plus size={12} />
                New
                <ChevronDown size={12} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-[180px] rounded-md border border-sand-300 bg-sand-50 p-1 shadow-xl dark:border-husk-50 dark:bg-husk-200"
              >
                <NewMenuItem
                  icon={<FolderPlus size={13} />}
                  label="Collection"
                  blurb="A plain list of cards you own."
                  onSelect={() => setCreateDialog('collection')}
                />
                <NewMenuItem
                  icon={<Star size={13} />}
                  label="Want-list"
                  blurb="Cards you're chasing."
                  onSelect={() => setCreateDialog('wishlist')}
                />
                <NewMenuItem
                  icon={<Sparkles size={13} />}
                  label="Smart collection"
                  blurb="A saved rule over your cards."
                  onSelect={openCreate}
                />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Filter binders"
        className="inline-flex rounded border border-sand-300 p-0.5 dark:border-husk-100"
      >
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
              filter === f.key
                ? 'bg-palm-500 text-coconut-50 dark:text-husk-300'
                : 'text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-coconut-400 dark:text-sand-300">
          <Loader2 size={12} className="animate-spin" />
          Loading binders…
        </div>
      ) : error ? (
        <div role="alert" className="text-xs text-sun-600 dark:text-sun-300">
          {error}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-xs text-coconut-500 dark:text-sand-300">{emptyMessage(filter)}</p>
      ) : (
        <ul className="divide-y divide-sand-200 dark:divide-husk-100">
          {visible.map((row) =>
            row.kind === 'owned' ? (
              <CollectionRow
                key={row.key}
                collection={row.collection}
                binders={binders}
                onOpenTarget={setTargetCollection}
                onOpenCollection={setOpenCollection}
                onEdit={openEdit}
                onDelete={removeCollection}
                onFile={fileCollection}
              />
            ) : (
              <WishlistRow
                key={row.key}
                wishlist={row.wishlist}
                binders={binders}
                onOpen={setOpenWishlist}
                onDelete={removeWishlist}
                onFile={fileWishlist}
              />
            ),
          )}
        </ul>
      )}

      <SmartCollectionTarget
        collection={targetCollection}
        open={targetCollection !== null}
        onOpenChange={(o) => {
          if (!o) setTargetCollection(null)
        }}
      />
      <CollectionDetail
        collection={openCollection}
        open={openCollection !== null}
        onOpenChange={(o) => {
          if (!o) setOpenCollection(null)
        }}
      />
      <WishlistDetail
        wishlist={openWishlist}
        open={openWishlist !== null}
        onOpenChange={(o) => {
          if (!o) setOpenWishlist(null)
        }}
      />
      <CollectionInsights open={insightsOpen} onOpenChange={setInsightsOpen} />
      <BinderModal
        key={modalKey}
        open={modalOpen}
        onOpenChange={setModalOpen}
        editing={editingBinder}
        // Create from the Binders tab is smart-collection-only now (#703);
        // physical binders come from "Add binder" above. Edit keeps the
        // binder's real mode.
        smartOnly={editingBinder === null}
      />
      <CollectionCreateDialog
        open={createDialog === 'collection'}
        onOpenChange={(o) => !o && setCreateDialog(null)}
      />
      <WishlistCreateDialog
        open={createDialog === 'wishlist'}
        onOpenChange={(o) => !o && setCreateDialog(null)}
      />
    </div>
  )
}

/** One item in the New ▾ menu — icon, label, and a one-line blurb. */
function NewMenuItem({
  icon,
  label,
  blurb,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  blurb: string
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-left outline-none data-[highlighted]:bg-sand-200 dark:data-[highlighted]:bg-husk-100"
    >
      <span className="mt-0.5 text-palm-600 dark:text-palm-300">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-coconut-700 dark:text-sand-50">
          {label}
        </span>
        <span className="block text-[10px] text-coconut-400 dark:text-sand-300">{blurb}</span>
      </span>
    </DropdownMenu.Item>
  )
}

/** Palm "Owned" / sun "Chasing" chip — mirrors OwnershipBadge (#576). */
/** Subtle marker on the list a bare one-tap Want/Own writes to (#759/#762).
 *  The default is just a normal list (rename/delete work on it like any other);
 *  this only signals where an unspecified save lands. */
function DefaultBadge({ noun }: { noun: 'Own' | 'Want' }) {
  return (
    <span
      title={`Default ${noun} target — a one-tap ${noun} saves here`}
      className="shrink-0 rounded-full border border-sand-300 px-1.5 py-0.5 text-[10px] font-medium text-coconut-400 dark:border-husk-50 dark:text-sand-300"
    >
      default
    </span>
  )
}

function KindBadge({ kind }: { kind: 'owned' | 'chasing' }) {
  return kind === 'owned' ? (
    <span className="shrink-0 rounded-full bg-palm-500/15 px-1.5 py-0.5 text-[10px] font-medium text-palm-600 dark:bg-palm-400/20 dark:text-palm-200">
      Owned
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-sun-400/20 px-1.5 py-0.5 text-[10px] font-medium text-husk-500 dark:bg-sun-400/25 dark:text-sun-200">
      Chasing
    </span>
  )
}

function CardCount({ count }: { count: number }) {
  return (
    <span className="ml-3 shrink-0 rounded bg-sand-200 px-2 py-0.5 text-[11px] text-coconut-600 dark:bg-husk-100 dark:text-sand-200">
      {count} {count === 1 ? 'card' : 'cards'}
    </span>
  )
}

/** `held / capacity` with a thin fill bar — how full a binder is. Falls back
 * to a plain count when no capacity is pinned. */
function CapacityFill({ count, capacity }: { count: number; capacity: number }) {
  const pct = Math.min(100, Math.round((count / capacity) * 100))
  const full = count >= capacity
  return (
    <div className="ml-3 flex shrink-0 flex-col items-end gap-0.5">
      <span className="text-[11px] tabular-nums text-coconut-500 dark:text-sand-200">
        {count}
        <span className="text-coconut-400 dark:text-sand-300"> / {capacity}</span>
      </span>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-sand-200 dark:bg-husk-100">
        <div
          className={`h-full rounded-full ${full ? 'bg-ember-500' : 'bg-palm-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** A collection carries binder identity if it's a physical binder or a smart
 * collection. */
function hasBinderIdentity(c: CollectionSummary): boolean {
  return c.kind === 'binder' || c.kind === 'dynamic'
}

const BINDER_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  BINDER_TYPE_OPTIONS.map((o) => [o.value, o.label]),
)

/** The storage-type / format / master-set chips that give a binder its shelf
 * identity in the list. Format is physical-only; the rest are shared. */
function BinderIdentity({ c }: { c: CollectionSummary }) {
  if (!hasBinderIdentity(c)) return null
  return (
    <>
      {c.binder_type && c.binder_type !== 'regular' && (
        <span className="shrink-0 rounded bg-sand-200 px-1.5 py-0.5 text-[10px] font-medium text-coconut-600 dark:bg-husk-100 dark:text-sand-200">
          {BINDER_TYPE_LABELS[c.binder_type] ?? c.binder_type}
        </span>
      )}
      {c.binder_format && (
        <span className="shrink-0 rounded bg-sand-200 px-1.5 py-0.5 text-[10px] font-medium text-coconut-600 dark:bg-husk-100 dark:text-sand-200">
          {c.binder_format}
        </span>
      )}
      {c.is_master_set && (
        <span className="shrink-0 rounded bg-sun-400/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-husk-500 dark:bg-sun-400/25 dark:text-sun-200">
          master set
        </span>
      )}
    </>
  )
}

function CollectionRow({
  collection: c,
  binders,
  onOpenTarget,
  onOpenCollection,
  onEdit,
  onDelete,
  onFile,
}: {
  collection: CollectionSummary
  binders: BinderSummary[]
  onOpenTarget: (c: CollectionSummary) => void
  onOpenCollection: (c: CollectionSummary) => void
  onEdit: (c: CollectionSummary) => void
  onDelete: (id: number) => Promise<void>
  onFile: (collectionId: number, binderId: number | null) => Promise<void>
}) {
  const pill = kindPill(c)
  const isBinder = c.kind === 'binder'
  const identity = hasBinderIdentity(c)
  const cover = coverSwatch(c.binder_color)
  // A catalog-scope target opens its progress detail; every other collection
  // opens its card-list detail — both are clickable so a row is never a dead
  // end (#723).
  const isTarget = isCatalogTarget(c)
  const body = (
    <>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {identity && c.binder_color ? (
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${cover.className}`}
              style={cover.style}
              aria-hidden
            />
          ) : (
            <KindBadge kind="owned" />
          )}
          <span className="truncate text-xs font-medium text-coconut-700 dark:text-sand-50">
            {c.name}
          </span>
          {c.is_default && <DefaultBadge noun="Own" />}
          {pill && (
            <span className="shrink-0 rounded bg-palm-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-palm-700 dark:bg-husk-100 dark:text-palm-300">
              {pill}
            </span>
          )}
          <BinderIdentity c={c} />
        </div>
        {c.description && (
          <div className="truncate text-[11px] text-coconut-400 dark:text-sand-300">
            {c.description}
          </div>
        )}
      </div>
      {isBinder && c.capacity ? (
        // Capacity counts occupied pockets — sum of item quantities (vendor
        // multiples), not row count. Falls back to item_count pre-#679.
        <CapacityFill count={c.total_quantity ?? c.item_count} capacity={c.capacity} />
      ) : (
        <CardCount count={c.item_count} />
      )}
    </>
  )
  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        onClick={() => (isTarget ? onOpenTarget(c) : onOpenCollection(c))}
        className="flex flex-1 items-center justify-between rounded py-2 text-left hover:bg-sand-100 dark:hover:bg-husk-100"
      >
        {body}
      </button>
      {identity && (
        <button
          type="button"
          onClick={() => onEdit(c)}
          aria-label={`Edit binder "${c.name}"`}
          title="Edit binder"
          className="shrink-0 rounded p-1.5 text-coconut-400 opacity-100 transition-opacity hover:bg-sand-200 hover:text-palm-600 dark:text-sand-400 dark:hover:bg-husk-100 dark:hover:text-palm-300 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
        >
          <Pencil size={14} />
        </button>
      )}
      {/* Any collection — including a smart collection, which can now be filed
          at create (#726) — can be re-filed or unfiled from the row, so it's
          never stuck on the wrong binder (#775 review). */}
      {binders.length > 0 && (
        <FileIntoBinderControl item={c} noun="collection" binders={binders} onFile={onFile} />
      )}
      <PrintIdCardControl collectionId={c.id} label={`collection "${c.name}"`} />
      <DeleteBinderControl label={`collection "${c.name}"`} onDelete={() => onDelete(c.id)} />
    </li>
  )
}

/**
 * Per-row "print ID card" affordance — downloads the binder-cover PDF (#507)
 * for the collection. The printer icon reveals on hover like the delete
 * control; a failed download surfaces a quiet inline note.
 */
function PrintIdCardControl({ collectionId, label }: { collectionId: number; label: string }) {
  const apiKey = useAppStore((s) => s.settings.apiKey)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <span className="flex shrink-0 items-center gap-1">
      {failed && (
        <span role="alert" className="text-[10px] text-ember-500 dark:text-ember-300">
          Couldn&apos;t print
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        aria-label={`Print ID card for ${label}`}
        title="Print ID card"
        onClick={async () => {
          setBusy(true)
          setFailed(false)
          try {
            await downloadCollectionIdCardPdf(collectionId, apiKey || undefined)
          } catch {
            setFailed(true)
          } finally {
            setBusy(false)
          }
        }}
        className="shrink-0 rounded p-1.5 text-coconut-400 opacity-100 transition-opacity hover:bg-sand-200 hover:text-palm-600 disabled:opacity-50 dark:text-sand-400 dark:hover:bg-husk-100 dark:hover:text-palm-300 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
      </button>
    </span>
  )
}

function WishlistRow({
  wishlist: w,
  binders,
  onOpen,
  onDelete,
  onFile,
}: {
  wishlist: WishlistSummary
  binders: BinderSummary[]
  onOpen: (w: WishlistSummary) => void
  onDelete: (id: number) => Promise<void>
  onFile: (wishlistId: number, binderId: number | null) => Promise<void>
}) {
  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        onClick={() => onOpen(w)}
        className="flex flex-1 items-center justify-between rounded py-2 text-left hover:bg-sand-100 dark:hover:bg-husk-100"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <KindBadge kind="chasing" />
            <span className="truncate text-xs font-medium text-coconut-700 dark:text-sand-50">
              {w.name}
            </span>
            {w.is_default && <DefaultBadge noun="Want" />}
          </div>
          {w.description && (
            <div className="truncate text-[11px] text-coconut-400 dark:text-sand-300">
              {w.description}
            </div>
          )}
        </div>
        <CardCount count={w.item_count} />
      </button>
      {/* A want-list files into a binder too (#774) — same control as a row. */}
      {binders.length > 0 && (
        <FileIntoBinderControl item={w} noun="want-list" binders={binders} onFile={onFile} />
      )}
      <DeleteBinderControl label={`want-list "${w.name}"`} onDelete={() => onDelete(w.id)} />
    </li>
  )
}

/**
 * Per-row "file into binder" control (#703, #774) — a dropdown listing the
 * user's physical binders. Picking one moves the list into it; "Remove from
 * binder" unfiles it. The current binder is checked. Reveals on hover/focus
 * like the other row controls. Shared by collection and want-list rows — the
 * `noun` only colors the accessible label.
 */
function FileIntoBinderControl({
  item: c,
  noun = 'collection',
  binders,
  onFile,
}: {
  item: { id: number; name: string; binder_id?: number | null }
  noun?: 'collection' | 'want-list'
  binders: BinderSummary[]
  onFile: (id: number, binderId: number | null) => Promise<void>
}) {
  const [failed, setFailed] = useState(false)

  async function file(binderId: number | null) {
    setFailed(false)
    try {
      await onFile(c.id, binderId)
    } catch {
      setFailed(true)
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      {failed && (
        <span role="alert" className="text-[10px] text-ember-500 dark:text-ember-300">
          Couldn&apos;t file
        </span>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`File ${noun} "${c.name}" into a binder`}
            title="File into binder"
            className="shrink-0 rounded p-1.5 text-coconut-400 opacity-100 transition-opacity hover:bg-sand-200 hover:text-palm-600 dark:text-sand-400 dark:hover:bg-husk-100 dark:hover:text-palm-300 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          >
            <FolderInput size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-[160px] rounded-md border border-sand-300 bg-sand-50 p-1 shadow-xl dark:border-husk-50 dark:bg-husk-200"
          >
            <DropdownMenu.Label className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-400">
              File into binder
            </DropdownMenu.Label>
            {binders.map((b) => (
              <DropdownMenu.CheckboxItem
                key={b.id}
                checked={c.binder_id === b.id}
                onSelect={() => void file(b.id)}
                className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-xs text-coconut-700 outline-none data-[highlighted]:bg-sand-200 dark:text-sand-50 dark:data-[highlighted]:bg-husk-100"
              >
                <span className="truncate">{b.name}</span>
                {c.binder_id === b.id && <Check size={12} className="shrink-0 text-palm-600" />}
              </DropdownMenu.CheckboxItem>
            ))}
            {c.binder_id != null && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-sand-200 dark:bg-husk-100" />
                <DropdownMenu.Item
                  onSelect={() => void file(null)}
                  className="cursor-pointer rounded px-2 py-1 text-xs text-ember-600 outline-none data-[highlighted]:bg-sand-200 dark:text-ember-300 dark:data-[highlighted]:bg-husk-100"
                >
                  Remove from binder
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  )
}

/**
 * Two-step delete affordance for a collection/want-list row. The trash icon is
 * always visible; clicking it swaps in an inline check/x confirm, since
 * deleting cascade-removes the row's cards and can't be undone. Mirrors the
 * saved-search delete (#772).
 */
function DeleteBinderControl({
  label,
  onDelete,
}: {
  label: string
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    setFailed(false)
    try {
      // On success the row unmounts, so there's nothing to reset here.
      await onDelete()
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        {failed && (
          <span role="alert" className="text-[10px] text-ember-500 dark:text-ember-300">
            Couldn&apos;t delete
          </span>
        )}
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={busy}
          aria-label={`Confirm delete ${label}`}
          className="rounded p-1 text-ember-600 hover:bg-ember-500/10 disabled:opacity-50 dark:text-ember-300 dark:hover:bg-husk-100"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false)
            setFailed(false)
          }}
          disabled={busy}
          aria-label="Cancel delete"
          className="rounded p-1 text-coconut-400 hover:bg-sand-200 disabled:opacity-50 dark:text-sand-300 dark:hover:bg-husk-100"
        >
          <X size={14} />
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Delete ${label}`}
      className="shrink-0 rounded p-1.5 text-coconut-400 hover:bg-sand-200 hover:text-ember-500 dark:text-sand-400 dark:hover:bg-husk-100 dark:hover:text-ember-300"
    >
      <Trash2 size={14} />
    </button>
  )
}
