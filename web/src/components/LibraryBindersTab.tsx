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
import { BarChart3, Loader2, Printer, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { downloadCollectionIdCardPdf } from '../api/client'
import type {
  CollectionRule,
  CollectionSummary,
  DynamicScope,
  WishlistSummary,
} from '../api/client'
import { useAppStore } from '../store'
import { CollectionInsights } from './CollectionInsights'
import { SmartCollectionTarget } from './SmartCollectionTarget'
import { WishlistDetail } from './WishlistDetail'
import { useCollections } from './useCollections'
import { useWishlists } from './useWishlists'

/** The single-predicate fields the inline rule builder offers. The API
 * accepts several predicates ANDed together; the V1 form keeps it to one. */
const RULE_FIELDS = [
  { key: 'name', label: 'Name contains' },
  { key: 'types', label: 'Type is' },
  { key: 'set_id', label: 'Set is' },
  { key: 'rarity', label: 'Rarity is' },
  { key: 'number', label: 'Number is' },
] as const

type RuleField = (typeof RULE_FIELDS)[number]['key']

/** The two dynamic scopes, framed for the toggle. `owned` is an inventory
 * view over your own cards; `catalog` is a target view over the whole
 * catalog with progress (#631). */
const SCOPE_OPTIONS: { key: DynamicScope; label: string }[] = [
  { key: 'owned', label: 'My cards' },
  { key: 'catalog', label: 'Whole catalog' },
]

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

function buildRule(field: RuleField, value: string): CollectionRule {
  const v = value.trim()
  // `types` is a list on the wire; every other predicate is a scalar.
  return field === 'types' ? { types: [v] } : { [field]: v }
}

/** A catalog-scope smart collection is a target with progress, so it reads
 * as "target"; an owned-scope one is an inventory view ("smart"). */
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
    return "No owned binders yet. Run a lookup, then click the bookmark icon on a matched row to start a collection — or spin up a smart collection above."
  if (filter === 'chasing')
    return "No want-lists yet. Run a lookup, then click the heart icon on a matched row to start chasing a card."
  return "You don't have any binders yet. Run a lookup, then click the bookmark icon to start a collection or the heart icon to start a want-list — or spin up a smart collection above."
}

export function LibraryBindersTab() {
  const {
    collections,
    loading: cLoading,
    error: cError,
    refresh: refreshCollections,
    create,
    remove: removeCollection,
  } = useCollections()
  const {
    wishlists,
    loading: wLoading,
    error: wError,
    refresh: refreshWishlists,
    remove: removeWishlist,
  } = useWishlists()

  const [filter, setFilter] = useState<BinderFilter>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [field, setField] = useState<RuleField>('name')
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<DynamicScope>('owned')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // The catalog-scope target collection whose detail modal is open.
  const [targetCollection, setTargetCollection] = useState<CollectionSummary | null>(null)
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !value.trim()) return
    setSubmitting(true)
    setFormError(null)
    try {
      await create(name.trim(), {
        kind: 'dynamic',
        rule: buildRule(field, value),
        dynamic_scope: scope,
      })
      setName('')
      setValue('')
      setFormOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
          Binders
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
          <button
            type="button"
            onClick={() => setFormOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-palm-600 hover:bg-palm-50 dark:text-palm-300 dark:hover:bg-husk-100"
          >
            <Sparkles size={12} />
            New smart collection
          </button>
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

      {formOpen && (
        <form
          onSubmit={handleCreate}
          className="space-y-2 rounded-md border border-sand-200 bg-sand-50 p-3 dark:border-husk-100 dark:bg-husk-200"
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Collection name (e.g. all Eevees)"
            className="w-full rounded border border-sand-300 bg-coconut-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-400 dark:border-husk-100 dark:bg-husk-100 dark:text-sand-50"
          />
          <div className="flex gap-2">
            <select
              value={field}
              onChange={(e) => setField(e.target.value as RuleField)}
              className="shrink-0 rounded border border-sand-300 bg-coconut-50 px-2 py-1 text-xs text-coconut-700 dark:border-husk-100 dark:bg-husk-100 dark:text-sand-50"
            >
              {RULE_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={field === 'types' ? 'Fire' : 'Eevee'}
              className="min-w-0 flex-1 rounded border border-sand-300 bg-coconut-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-400 dark:border-husk-100 dark:bg-husk-100 dark:text-sand-50"
            />
          </div>
          <div>
            <div
              role="radiogroup"
              aria-label="Membership scope"
              className="inline-flex rounded border border-sand-300 p-0.5 dark:border-husk-100"
            >
              {SCOPE_OPTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="radio"
                  aria-checked={scope === s.key}
                  onClick={() => setScope(s.key)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    scope === s.key
                      ? 'bg-palm-500 text-coconut-50 dark:text-husk-300'
                      : 'text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-coconut-400 dark:text-sand-300">
              {scope === 'owned'
                ? 'Filters the cards you already own.'
                : 'Pulls every match from the catalog and tracks your progress.'}
            </p>
          </div>
          {formError && (
            <div role="alert" className="text-[11px] text-sun-600 dark:text-sun-300">
              {formError}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !name.trim() || !value.trim()}
            className="inline-flex items-center gap-1 rounded bg-palm-500 px-3 py-1 text-[11px] font-medium text-coconut-50 hover:bg-palm-600 disabled:opacity-50 dark:text-husk-300"
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            Create
          </button>
        </form>
      )}

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
                onOpenTarget={setTargetCollection}
                onDelete={removeCollection}
              />
            ) : (
              <WishlistRow
                key={row.key}
                wishlist={row.wishlist}
                onOpen={setOpenWishlist}
                onDelete={removeWishlist}
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
      <WishlistDetail
        wishlist={openWishlist}
        open={openWishlist !== null}
        onOpenChange={(o) => {
          if (!o) setOpenWishlist(null)
        }}
      />
      <CollectionInsights open={insightsOpen} onOpenChange={setInsightsOpen} />
    </div>
  )
}

/** Palm "Owned" / sun "Chasing" chip — mirrors OwnershipBadge (#576). */
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

function CollectionRow({
  collection: c,
  onOpenTarget,
  onDelete,
}: {
  collection: CollectionSummary
  onOpenTarget: (c: CollectionSummary) => void
  onDelete: (id: number) => Promise<void>
}) {
  const pill = kindPill(c)
  // A catalog-scope target opens its progress detail; everything else is
  // a static row.
  const openable = isCatalogTarget(c)
  const body = (
    <>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <KindBadge kind="owned" />
          <span className="truncate text-xs font-medium text-coconut-700 dark:text-sand-50">
            {c.name}
          </span>
          {pill && (
            <span className="shrink-0 rounded bg-palm-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-palm-700 dark:bg-husk-100 dark:text-palm-300">
              {pill}
            </span>
          )}
        </div>
        {c.description && (
          <div className="truncate text-[11px] text-coconut-400 dark:text-sand-300">
            {c.description}
          </div>
        )}
      </div>
      <CardCount count={c.item_count} />
    </>
  )
  return (
    <li className="group flex items-center gap-1">
      {openable ? (
        <button
          type="button"
          onClick={() => onOpenTarget(c)}
          className="flex flex-1 items-center justify-between rounded py-2 text-left hover:bg-sand-100 dark:hover:bg-husk-100"
        >
          {body}
        </button>
      ) : (
        <div className="flex flex-1 items-center justify-between py-2">{body}</div>
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
  onOpen,
  onDelete,
}: {
  wishlist: WishlistSummary
  onOpen: (w: WishlistSummary) => void
  onDelete: (id: number) => Promise<void>
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
          </div>
          {w.description && (
            <div className="truncate text-[11px] text-coconut-400 dark:text-sand-300">
              {w.description}
            </div>
          )}
        </div>
        <CardCount count={w.item_count} />
      </button>
      <DeleteBinderControl label={`want-list "${w.name}"`} onDelete={() => onDelete(w.id)} />
    </li>
  )
}

/**
 * Two-step delete affordance for a binder row. The trash icon reveals on
 * hover/focus (mirrors the Recent tab); clicking it swaps in an inline
 * "Delete / Cancel" confirm, since removing a binder cascade-deletes its
 * cards and can't be undone.
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
      <div className="flex shrink-0 items-center gap-1">
        {failed && (
          <span role="alert" className="text-[10px] text-ember-500 dark:text-ember-300">
            Couldn&apos;t delete
          </span>
        )}
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded bg-ember-500 px-2 py-1 text-[11px] font-medium text-coconut-50 hover:bg-ember-600 disabled:opacity-50"
        >
          {busy && <Loader2 size={11} className="animate-spin" />}
          Delete
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false)
            setFailed(false)
          }}
          disabled={busy}
          className="rounded px-2 py-1 text-[11px] font-medium text-coconut-500 hover:bg-sand-200 disabled:opacity-50 dark:text-sand-300 dark:hover:bg-husk-100"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Delete ${label}`}
      className="shrink-0 rounded p-1.5 text-coconut-400 opacity-100 transition-opacity hover:bg-sand-200 hover:text-ember-500 focus-visible:opacity-100 dark:text-sand-400 dark:hover:bg-husk-100 dark:hover:text-ember-300 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
    >
      <Trash2 size={14} />
    </button>
  )
}
