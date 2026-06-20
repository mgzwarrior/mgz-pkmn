/**
 * BinderInventory — the physical-binder inventory at the top of the Binders
 * tab (#702). A binder is a real binder you own; it can sit empty until you
 * fill it, and (via #3) hold one or more collections. Reads/writes the
 * `/api/v1/binders` resource through [useBinders](./useBinders.ts).
 *
 * Scoped to inventory CRUD: listing binders, adding an empty one, and
 * removing one (which detaches — never deletes — any collections filed in
 * it). Filing collections into a binder is #3.
 */
import { Check, Library, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { BinderFormat } from '../api/client'
import { BINDER_FORMAT_OPTIONS, coverSwatch } from './binderIdentity'
import { useBinders } from './useBinders'

export function BinderInventory() {
  const { binders, loading, error, create, remove } = useBinders()

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [format, setFormat] = useState<BinderFormat | ''>('')
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

  function resetForm() {
    setName('')
    setFormat('')
    setCapacity('')
    setSubmitError(null)
  }

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setSubmitError(null)
    try {
      const cap = capacity.trim() ? Number(capacity) : null
      await create(trimmed, {
        binder_format: format || null,
        capacity: cap && cap > 0 ? cap : null,
      })
      resetForm()
      setCreating(false)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await remove(id)
    } finally {
      setConfirmingId(null)
    }
  }

  return (
    <section className="space-y-2" aria-label="Your binders">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
          <Library size={12} aria-hidden />
          Your binders
        </span>
        <button
          type="button"
          onClick={() => {
            resetForm()
            setCreating((c) => !c)
          }}
          aria-expanded={creating}
          className="inline-flex items-center gap-1 rounded bg-palm-500 px-2 py-1 text-[11px] font-medium text-coconut-50 hover:bg-palm-600 dark:text-husk-300"
        >
          <Plus size={12} />
          Add binder
        </button>
      </div>

      {creating && (
        <div className="space-y-2 rounded border border-sand-300 p-2 dark:border-husk-100">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleCreate()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setCreating(false)
              }
            }}
            placeholder="Binder name"
            aria-label="Binder name"
            className="w-full rounded border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-100 dark:text-sand-50 dark:placeholder:text-sand-500 dark:focus:ring-sun-300"
          />
          <div className="flex items-center gap-1">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as BinderFormat | '')}
              aria-label="Binder format"
              className="flex-1 rounded border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-100 dark:text-sand-50 dark:focus:ring-sun-300"
            >
              <option value="">Format</option>
              {BINDER_FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleCreate()
                }
              }}
              placeholder="Slots"
              aria-label="Capacity (slots)"
              className="w-20 rounded border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-100 dark:text-sand-50 dark:placeholder:text-sand-500 dark:focus:ring-sun-300"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy || !name.trim()}
              className="rounded bg-palm-400 px-2 py-1 text-xs font-medium text-sand-50 hover:bg-palm-300 disabled:opacity-50 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
            </button>
          </div>
          {submitError && (
            <p className="text-xs text-sun-600 dark:text-sun-300">{submitError}</p>
          )}
        </div>
      )}

      {loading && binders.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-coconut-400 dark:text-sand-300">
          <Loader2 size={12} className="animate-spin" />
          Loading binders…
        </div>
      ) : error ? (
        <div role="alert" className="text-xs text-sun-600 dark:text-sun-300">
          {error}
        </div>
      ) : binders.length === 0 ? (
        <p className="text-xs text-coconut-500 dark:text-sand-300">
          No binders yet. Add an empty binder to your inventory and fill it as you go.
        </p>
      ) : (
        <ul className="space-y-1">
          {binders.map((b) => {
            const swatch = coverSwatch(b.binder_color)
            return (
              <li
                key={b.id}
                className="flex items-center gap-2 rounded border border-sand-200 px-2 py-1.5 dark:border-husk-100"
              >
                <span
                  className={`h-6 w-5 shrink-0 rounded-sm ${swatch.className}`}
                  style={swatch.style}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-coconut-700 dark:text-sand-50">{b.name}</p>
                  <p className="text-[11px] text-coconut-400 dark:text-sand-300">
                    {b.is_empty
                      ? 'Empty'
                      : `${b.collection_count} ${b.collection_count === 1 ? 'collection' : 'collections'}`}
                    {b.binder_format ? ` · ${b.binder_format}` : ''}
                    {b.capacity ? ` · ${b.capacity} slots` : ''}
                  </p>
                </div>
                {confirmingId === b.id ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleDelete(b.id)}
                      aria-label={`Confirm delete ${b.name}`}
                      className="rounded p-1 text-sun-600 hover:bg-sun-50 dark:text-sun-300 dark:hover:bg-husk-100"
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      aria-label="Cancel delete"
                      className="rounded p-1 text-coconut-400 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
                    >
                      <X size={13} />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(b.id)}
                    aria-label={`Delete ${b.name}`}
                    className="rounded p-1 text-coconut-400 hover:text-sun-600 dark:text-sand-300 dark:hover:text-sun-300"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
