import type { CardCondition } from '../types'
import { CONDITION_OPTIONS } from '../utils/conditionPricing'

export function ConditionOverrideSelect({
  label,
  value,
  defaultCondition,
  onChange,
  className = '',
}: {
  label: string
  value: CardCondition | null
  defaultCondition: CardCondition
  onChange: (condition: CardCondition | null) => void
  className?: string
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as CardCondition))}
      className={`rounded border border-sand-300 bg-sand-100 px-1.5 py-1 text-xs text-coconut-600 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-200 dark:focus:ring-sun-300 ${className}`}
    >
      <option value="">Default ({defaultCondition})</option>
      {CONDITION_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.value}
        </option>
      ))}
    </select>
  )
}
