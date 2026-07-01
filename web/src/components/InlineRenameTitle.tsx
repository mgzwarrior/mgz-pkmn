/**
 * InlineRenameTitle — the editable name in a detail modal's header (#787).
 *
 * Renders the list's name as the `Dialog.Title` with a pencil affordance;
 * clicking it swaps in an input with save / cancel. Shared by
 * [CollectionDetail](./CollectionDetail.tsx) and
 * [WishlistDetail](./WishlistDetail.tsx) so both rename the same way.
 *
 * Validation stays light: the name is trimmed and a blank (or unchanged) value
 * is a no-op. `onRename` persists via the existing PATCH; the caller reflects
 * the new name locally so the header updates without a reload.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { useState } from 'react'

interface Props {
  /** The current name; falls back to `fallback` when empty. */
  name: string
  /** Placeholder title when `name` is blank (e.g. "Collection"). */
  fallback: string
  /** Accessible verb for the controls, e.g. "wishlist" → "Rename wishlist". */
  noun: string
  /** Persist the trimmed name. Rejecting keeps the editor open for a retry. */
  onRename: (name: string) => Promise<void>
}

export function InlineRenameTitle({ name, fallback, noun, onRename }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  function start() {
    setDraft(name)
    setFailed(false)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setBusy(false)
    setFailed(false)
  }

  async function save() {
    const next = draft.trim()
    if (!next || next === name) {
      cancel()
      return
    }
    setBusy(true)
    setFailed(false)
    try {
      await onRename(next)
      setEditing(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <Dialog.Title className="truncate text-lg font-semibold text-coconut-700 dark:text-sand-50">
          {name || fallback}
        </Dialog.Title>
        <button
          type="button"
          onClick={start}
          aria-label={`Rename ${noun}`}
          className="shrink-0 rounded p-1 text-coconut-400 hover:bg-sand-200 hover:text-coconut-600 dark:text-sand-300 dark:hover:bg-husk-100"
        >
          <Pencil size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {/* Radix requires a Dialog.Title for the dialog's accessible name; keep
          it mounted (hidden) while the visible input takes over. */}
      <Dialog.Title className="sr-only">{name || fallback}</Dialog.Title>
      <input
        autoFocus
        value={draft}
        disabled={busy}
        aria-label={`${noun} name`}
        aria-invalid={failed || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape') {
            // Cancel the rename without letting the dialog itself close.
            e.preventDefault()
            e.stopPropagation()
            cancel()
          }
        }}
        className={`min-w-0 flex-1 rounded border bg-sand-50 px-2 py-1 text-lg font-semibold text-coconut-700 outline-none focus:border-palm-500 dark:bg-husk-100 dark:text-sand-50 ${
          failed
            ? 'border-sun-500 dark:border-sun-400'
            : 'border-sand-300 dark:border-husk-50'
        }`}
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || !draft.trim()}
        aria-label={`Save ${noun} name`}
        className="shrink-0 rounded p-1 text-palm-600 hover:bg-sand-200 disabled:opacity-50 dark:text-palm-300 dark:hover:bg-husk-100"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        aria-label={`Cancel renaming ${noun}`}
        className="shrink-0 rounded p-1 text-coconut-500 hover:bg-sand-200 disabled:opacity-50 dark:text-sand-300 dark:hover:bg-husk-100"
      >
        <X size={16} />
      </button>
    </div>
  )
}
