/**
 * BinderColorPicker — the cover-color swatch row shared by the binder
 * create/edit surfaces: preset color tokens (#681) plus a native custom-hex
 * picker styled as a swatch. Clicking the active preset clears it (back to
 * no color). Extracted from BinderModal so the "Add binder" inventory form
 * and the smart-collection modal share one control.
 */
import {
  BINDER_COLOR_OPTIONS,
  SWATCH_BG,
} from './binderIdentity'

//: Seed value for the native color picker before a hex is chosen — a neutral
//: gray, not a brand color, so it stays clear of the no-hex theme rule.
const CUSTOM_COLOR_SEED = '#8a8a8a'

interface Props {
  /** Current color: a preset token stem, a ``#rrggbb`` hex, or null. */
  value: string | null
  onChange: (color: string | null) => void
  /** Optional label above the swatches. Hidden when omitted. */
  label?: string
}

export function BinderColorPicker({ value, onChange, label }: Props) {
  const customActive = Boolean(value?.startsWith('#'))
  return (
    <div className="space-y-1.5">
      {label && (
        <span className="text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
          {label}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {BINDER_COLOR_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-label={opt.label}
            aria-pressed={value === opt.value}
            title={opt.label}
            onClick={() => onChange(value === opt.value ? null : opt.value)}
            className={`h-7 w-7 rounded-full ${SWATCH_BG[opt.value]} ring-offset-1 ring-offset-sand-50 transition dark:ring-offset-husk-200 ${
              value === opt.value
                ? 'ring-2 ring-coconut-600 dark:ring-sand-50'
                : 'ring-1 ring-sand-300 dark:ring-husk-100'
            }`}
          />
        ))}
        {/* Custom hex — a native color input styled as a swatch. */}
        <label
          title="Custom color"
          className={`relative h-7 w-7 cursor-pointer overflow-hidden rounded-full ring-offset-1 ring-offset-sand-50 transition dark:ring-offset-husk-200 ${
            customActive
              ? 'ring-2 ring-coconut-600 dark:ring-sand-50'
              : 'ring-1 ring-sand-300 dark:ring-husk-100'
          }`}
          style={customActive && value ? { backgroundColor: value } : undefined}
        >
          {!customActive && (
            <span className="absolute inset-0 bg-[conic-gradient(red,orange,yellow,lime,aqua,blue,magenta,red)] opacity-70" />
          )}
          <input
            type="color"
            aria-label="Custom cover color"
            value={customActive && value ? value : CUSTOM_COLOR_SEED}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  )
}
