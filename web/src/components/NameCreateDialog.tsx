/**
 * NameCreateDialog — a minimal name-only create dialog (#703).
 *
 * The New ▾ menu in the Binders tab uses this for the two logical-list
 * creates that need nothing but a name: a plain collection and a want-list.
 * (Smart binders go through the richer [BinderModal](./BinderModal.tsx).)
 *
 * Submits on Enter or the action button; surfaces a server error inline and
 * leaves the dialog open so the user can retry. Clears the field whenever
 * the dialog (re)opens.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import { useState } from 'react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  placeholder: string
  submitLabel: string
  /** Seed the name field (e.g. opened from Browse for a set/species, #737). */
  initialName?: string
  /** Create with the trimmed name. Throw to surface an inline error. */
  onSubmit: (name: string) => Promise<void>
}

export function NameCreateDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(400px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200">
          {/* The form (and its state) only mounts while the dialog is open, so
              the field starts fresh each open — no reset effect needed. */}
          <CreateForm {...rest} onClose={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CreateForm({
  title,
  placeholder,
  submitLabel,
  initialName,
  onSubmit,
  onClose,
}: Omit<Props, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [name, setName] = useState(initialName ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim().length > 0 && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
        <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
          {title}
        </Dialog.Title>
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
        Give it a name and create it.
      </Dialog.Description>

      <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
            Name
          </span>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded border border-sand-300 bg-coconut-50 px-2.5 py-1.5 text-sm text-coconut-700 placeholder:text-coconut-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-100 dark:bg-husk-100 dark:text-sand-50 dark:focus:ring-sun-300"
          />
        </label>

        {error && (
          <div role="alert" className="text-[11px] text-sun-600 dark:text-sun-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-sand-200 pt-3 dark:border-husk-100">
          <Dialog.Close asChild>
            <button
              type="button"
              className="rounded px-3 py-1.5 text-xs font-medium text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
            >
              Cancel
            </button>
          </Dialog.Close>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded bg-palm-500 px-3.5 py-1.5 text-xs font-medium text-coconut-50 hover:bg-palm-600 disabled:opacity-50 dark:text-husk-300"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </form>
    </>
  )
}
