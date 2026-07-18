/**
 * PricingOverrideCell — inline editor for a row's manual price override (#266).
 *
 * Click to open a number input (save on blur / Enter, discard on Escape); a
 * set override shows a pin icon plus a "Clear override" button. Shared by
 * the desktop {@link ResultsTable} row and the mobile {@link ResultCard}.
 */
import { useState } from 'react'
import { Pin, X } from 'lucide-react'
import { formatMoney } from '../utils/format'

interface Props {
  value: number | null
  currency: string
  label: string
  onChange: (value: number | null) => void
  className?: string
}

export function PricingOverrideCell({ value, currency, label, onChange, className = '' }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(value != null ? String(value) : '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value != null) onChange(null)
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) return
    const rounded = Math.round((parsed + Number.EPSILON) * 100) / 100
    if (rounded !== value) onChange(rounded)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        className={`w-20 rounded border border-sand-300 bg-sand-100 px-1.5 py-1 text-xs text-coconut-600 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-200 dark:focus:ring-sun-300 ${className}`}
      />
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          startEdit()
        }}
        aria-label={label}
        title={value != null ? 'User-set price override' : 'Set a manual price override'}
        className="flex items-center gap-1 text-xs text-coconut-400 hover:text-coconut-600 dark:text-sand-300 dark:hover:text-sand-200"
      >
        {value != null && (
          <Pin className="h-3 w-3 text-palm-500 dark:text-sun-300" aria-hidden="true" />
        )}
        {value != null ? formatMoney(value, currency) : 'Set override'}
      </button>
      {value != null && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onChange(null)
          }}
          aria-label="Clear override"
          title="Clear override"
          className="text-coconut-300 hover:text-ember-500 dark:text-sand-400 dark:hover:text-ember-300"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
