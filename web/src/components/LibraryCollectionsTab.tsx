/**
 * LibraryCollectionsTab — list view of collections (*"I own these"*) for
 * the Collections tab inside [LibraryPanel](./LibraryPanel.tsx). Names +
 * card counts in V1; the per-row Save-to-collection button on the results
 * table creates manual entries here.
 *
 * Smart (dynamic) collections (#506) are created from the inline form at
 * the top: a saved rule whose membership is whatever you already own that
 * matches it, recomputed live. A pill marks dynamic / set collections so
 * they read differently from hand-curated ones.
 */
import { Loader2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  CollectionRule,
  CollectionSummary,
  DynamicScope,
} from '../api/client'
import { SmartCollectionTarget } from './SmartCollectionTarget'
import { useCollections } from './useCollections'

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

export function LibraryCollectionsTab() {
  const { collections, loading, error, refresh, create } = useCollections()

  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [field, setField] = useState<RuleField>('name')
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<DynamicScope>('owned')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // The catalog-scope target collection whose detail modal is open.
  const [targetCollection, setTargetCollection] = useState<CollectionSummary | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

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
          Collections
        </span>
        <button
          type="button"
          onClick={() => setFormOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-palm-600 hover:bg-palm-50 dark:text-palm-300 dark:hover:bg-husk-100"
        >
          <Sparkles size={12} />
          New smart collection
        </button>
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

      {loading && collections.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-coconut-400 dark:text-sand-300">
          <Loader2 size={12} className="animate-spin" />
          Loading collections…
        </div>
      ) : error ? (
        <div role="alert" className="text-xs text-sun-600 dark:text-sun-300">
          {error}
        </div>
      ) : collections.length === 0 ? (
        <p className="text-xs text-coconut-500 dark:text-sand-300">
          You don&apos;t have any collections yet. Run a lookup, then click the
          bookmark icon on a matched row to start one — or spin up a smart
          collection above.
        </p>
      ) : (
        <ul className="divide-y divide-sand-200 dark:divide-husk-100">
          {collections.map((c) => {
            const pill = kindPill(c)
            // A catalog-scope target opens its progress detail; everything
            // else is a static row.
            const openable = isCatalogTarget(c)
            const body = (
              <>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
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
                <span className="ml-3 shrink-0 rounded bg-sand-200 px-2 py-0.5 text-[11px] text-coconut-600 dark:bg-husk-100 dark:text-sand-200">
                  {c.item_count} {c.item_count === 1 ? 'card' : 'cards'}
                </span>
              </>
            )
            return (
              <li key={c.id}>
                {openable ? (
                  <button
                    type="button"
                    onClick={() => setTargetCollection(c)}
                    className="flex w-full items-center justify-between rounded py-2 text-left hover:bg-sand-100 dark:hover:bg-husk-100"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center justify-between py-2">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <SmartCollectionTarget
        collection={targetCollection}
        open={targetCollection !== null}
        onOpenChange={(o) => {
          if (!o) setTargetCollection(null)
        }}
      />
    </div>
  )
}
