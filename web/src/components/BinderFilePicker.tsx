/**
 * BinderFilePicker — the shared "file this list into a binder" control (#726).
 *
 * Extracted from CollectionCreateDialog (#723) so the smart-collection create
 * flow can reuse the exact same affordance: pick an existing binder (each shown
 * with its free slots), create one inline (whether or not binders already
 * exist), or leave the list loose. Filing is always optional. State + the
 * resolve logic live in [useBinderFiling](./useBinderFiling.ts); this is the
 * presentation.
 */
import { Library, Loader2, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { BinderSummary } from '../api/client'
import { BinderColorPicker } from './BinderColorPicker'
import { coverSwatch } from './binderIdentity'
import type { BinderFiling } from './useBinderFiling'

const inputClass =
  'w-full rounded border border-sand-300 bg-coconut-50 px-2.5 py-1.5 text-sm text-coconut-700 placeholder:text-coconut-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-100 dark:bg-husk-100 dark:text-sand-50 dark:focus:ring-sun-300'

/** Slots still free in a binder: capacity minus the cards already filed into
 *  it. Returns null when the binder has no capacity pinned (no slot limit). */
function freeSlots(binder: BinderSummary, usedByBinder: Map<number, number>): number | null {
  if (binder.capacity == null) return null
  return Math.max(0, binder.capacity - (usedByBinder.get(binder.id) ?? 0))
}

/** The free/capacity hint under a binder option. Empty binders read "Empty",
 *  capacity-less binders read "No slot limit". */
function slotHint(free: number | null, capacity: number | null | undefined): string {
  if (capacity == null) return 'No slot limit'
  if (free === capacity) return `Empty · ${capacity} slots`
  return `${free} of ${capacity} slots free`
}

export function BinderFilePicker({ filing }: { filing: BinderFiling }) {
  const { settled, hasBinders, binders, usedByBinder, target, setTarget } = filing

  if (!settled) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-coconut-400 dark:text-sand-300">
        <Loader2 size={12} className="animate-spin" />
        Loading your binders…
      </div>
    )
  }

  // No binders yet — the inline create form is the only path, shown directly.
  if (!hasBinders) {
    return (
      <div className="space-y-2 rounded-md border border-sand-200 bg-coconut-50 p-3 dark:border-husk-100 dark:bg-husk-100">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-coconut-500 dark:text-sand-200">
          <Library size={12} aria-hidden />
          No binders yet — create one to file this into (optional)
        </div>
        <NewBinderFields filing={filing} />
      </div>
    )
  }

  // Binders exist — pick one, leave it loose, or create a new one inline.
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
        File into a binder (optional)
      </legend>
      <BinderRadio
        checked={target === null}
        onSelect={() => setTarget(null)}
        label="Don't file"
        hint="Leave it loose."
      />
      {binders.map((b) => (
        <BinderRadio
          key={b.id}
          checked={target === b.id}
          onSelect={() => setTarget(b.id)}
          label={b.name}
          hint={slotHint(freeSlots(b, usedByBinder), b.capacity)}
          swatch={coverSwatch(b.binder_color)}
        />
      ))}
      <BinderRadio
        checked={target === 'new'}
        onSelect={() => setTarget('new')}
        label="New binder"
        hint="Create one to file this into."
        icon={<Plus size={12} aria-hidden />}
      />
      {target === 'new' && (
        <div className="space-y-2 rounded-md border border-sand-200 bg-coconut-50 p-3 dark:border-husk-100 dark:bg-husk-100">
          <NewBinderFields filing={filing} />
        </div>
      )}
    </fieldset>
  )
}

/** The inline new-binder fields — name, cover color, capacity. Shared by the
 *  no-binders empty state and the "New binder" option in the radio list. */
function NewBinderFields({ filing }: { filing: BinderFiling }) {
  const {
    newBinderName,
    setNewBinderName,
    newBinderColor,
    setNewBinderColor,
    newBinderCapacity,
    setNewBinderCapacity,
  } = filing
  return (
    <>
      <input
        type="text"
        value={newBinderName}
        onChange={(e) => setNewBinderName(e.target.value)}
        placeholder="Binder name, e.g. Slot 1"
        aria-label="New binder name"
        className={inputClass}
      />
      <BinderColorPicker value={newBinderColor} onChange={setNewBinderColor} label="Cover color" />
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-coconut-500 dark:text-sand-300">
          Capacity (slots)
        </span>
        <input
          type="number"
          min={1}
          value={newBinderCapacity}
          onChange={(e) => setNewBinderCapacity(e.target.value)}
          placeholder="360"
          aria-label="New binder capacity (slots)"
          className={inputClass}
        />
      </label>
    </>
  )
}

function BinderRadio({
  checked,
  onSelect,
  label,
  hint,
  swatch,
  icon,
}: {
  checked: boolean
  onSelect: () => void
  label: string
  hint: string
  swatch?: { className: string; style?: { backgroundColor: string } }
  icon?: ReactNode
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-left transition ${
        checked
          ? 'border-palm-400 bg-palm-50 dark:border-palm-300 dark:bg-husk-100'
          : 'border-sand-300 bg-coconut-50 hover:border-sand-400 dark:border-husk-100 dark:bg-husk-100'
      }`}
    >
      <input
        type="radio"
        name="binder-file-target"
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {swatch ? (
        <span
          className={`h-5 w-4 shrink-0 rounded-sm ${swatch.className}`}
          style={swatch.style}
          aria-hidden
        />
      ) : icon ? (
        <span className="flex h-5 w-4 shrink-0 items-center justify-center text-coconut-400 dark:text-sand-300">
          {icon}
        </span>
      ) : (
        <span className="h-5 w-4 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-coconut-700 dark:text-sand-50">
          {label}
        </span>
        <span className="block text-[10px] text-coconut-400 dark:text-sand-300">{hint}</span>
      </span>
    </label>
  )
}
