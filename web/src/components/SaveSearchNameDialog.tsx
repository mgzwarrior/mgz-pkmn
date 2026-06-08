/**
 * SaveSearchNameDialog — Radix-backed prompt for the saved-search name.
 *
 * Replaces the native `window.prompt` so the affordance matches the rest
 * of the SPA's design system (sand / husk / palm tokens, focus ring,
 * dark-mode-aware). Two callers:
 *
 * - {@link SaveSearchButton} — opens the dialog on the signed-in / self-
 *   host path. Submitting calls `saveRun` for the live `currentRunId`.
 * - {@link App} — opens the dialog after a sign-in redirect resolves a
 *   pending save handoff. Submitting saves against the stashed `runId`
 *   from `consumePendingSaveSearch()` (the run no longer lives in the
 *   store after the OAuth round-trip's full-page reload).
 *
 * The dialog is purely a name collector: it does not call the API. The
 * parent owns the save call so it can sequence the follow-up list
 * refresh / error surface against its own state.
 *
 * The form body is split into a sibling component that only mounts when
 * `open` is true. That way the input's initial value is the prop the
 * parent passed *at the moment the dialog opened*, without a setState-
 * in-effect cascade — re-opening with a different `defaultName` mounts
 * a fresh body instead of mutating the existing one.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Bookmark, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Initial value of the name input — empty string for a new save,
   * the existing name for a rename, or the pending-handoff default.
   * Read once when the dialog opens. */
  defaultName?: string
  /** Dialog heading + button copy hint — "Name this saved search" or
   * "Rename this saved search". Drives `Dialog.Title` and the submit
   * button label so the same dialog covers both modes. */
  mode: 'name' | 'rename'
  /** Called with the trimmed name on submit. The parent closes the
   * dialog by flipping `open` once its save flow resolves. */
  onSubmit: (name: string) => void
}

export function SaveSearchNameDialog({ open, onOpenChange, defaultName = '', mode, onSubmit }: Props) {
  const heading = mode === 'rename' ? 'Rename this saved search' : 'Name this saved search'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 dark:bg-husk-500/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200 shadow-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 dark:border-husk-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <Bookmark size={18} className="text-coconut-600 dark:text-sand-200" />
              <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
                {heading}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-700 dark:hover:text-sand-50"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </header>

          {open && (
            <SaveSearchNameForm defaultName={defaultName} mode={mode} onSubmit={onSubmit} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface FormProps {
  defaultName: string
  mode: 'name' | 'rename'
  onSubmit: (name: string) => void
}

function SaveSearchNameForm({ defaultName, mode, onSubmit }: FormProps) {
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState<string | null>(null)
  const submitLabel = mode === 'rename' ? 'Rename' : 'Save'

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError('A name is required to save a search.')
      return
    }
    onSubmit(trimmed)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-5 py-4">
      <label htmlFor="save-search-name" className="text-xs font-medium text-coconut-600 dark:text-sand-200">
        Search name
      </label>
      <input
        id="save-search-name"
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={200}
        className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-100 px-3 py-2 text-sm text-coconut-700 dark:text-sand-50 focus:outline-none focus:ring-2 focus:ring-palm-400 dark:focus:ring-sun-400"
        placeholder="Show prep, June"
      />
      {error && (
        <p role="alert" className="text-xs text-ember-500 dark:text-ember-300">
          {error}
        </p>
      )}
      <footer className="mt-1 flex items-center justify-end gap-2">
        <Dialog.Close asChild>
          <button
            type="button"
            className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-600 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100"
          >
            Cancel
          </button>
        </Dialog.Close>
        <button
          type="submit"
          className="flex items-center gap-1.5 rounded-md border border-palm-400 dark:border-sun-400 bg-sun-400 dark:bg-sun-400 px-3 py-1.5 text-sm font-medium text-coconut-700 dark:text-husk-500 hover:bg-sun-300 dark:hover:bg-sun-300"
        >
          <Bookmark size={14} aria-hidden />
          {submitLabel}
        </button>
      </footer>
    </form>
  )
}
