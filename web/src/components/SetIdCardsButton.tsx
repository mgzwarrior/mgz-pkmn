/**
 * SetIdCardsButton — a standalone entry into the "Set ID cards…" picker.
 *
 * The export controls live in Search mode (#736), but Set ID cards is
 * row-independent — it fetches the full set catalog server-side and needs no
 * matched rows. Walking a set in Browse is exactly when you'd want to print
 * its ID cards, so this surfaces the picker there without dragging the rest of
 * the (row-dependent) export menu along.
 */
import { Tags } from 'lucide-react'
import { useState } from 'react'
import { SetPickerModal } from './SetPickerModal'

export function SetIdCardsButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Set ID cards"
        className="inline-flex items-center gap-1.5 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2.5 py-1 text-xs text-coconut-600 dark:text-sand-200 hover:bg-sand-50 dark:hover:bg-husk-200"
      >
        <Tags size={14} />
        <span className="hidden sm:inline">Set ID cards…</span>
      </button>
      <SetPickerModal open={open} onOpenChange={setOpen} />
    </>
  )
}
