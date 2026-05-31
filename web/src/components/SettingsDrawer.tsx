/**
 * SettingsDrawer — slide-in panel for API key, price cap, and display toggles.
 * Uses the Radix Dialog primitive styled with Tailwind.
 */
import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { Settings as SettingsIcon, X } from 'lucide-react'
import { useAppStore } from '../store'
import type { SortMode } from '../types'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'number', label: 'Card number (group by set) — default' },
  { value: 'number-desc', label: 'Card number, descending' },
  { value: 'price-asc', label: 'Price, ascending' },
  { value: 'price-desc', label: 'Price, descending' },
  { value: 'release-date', label: 'Release date (chronological)' },
  { value: 'alpha', label: 'Card name (alphabetical)' },
]

export function SettingsDrawer() {
  const { settings, updateSettings, resetSettings } = useAppStore()

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2.5 py-1.5 text-sm text-coconut-600 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors sm:px-3"
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon size={15} />
          <span className="hidden sm:inline">Settings</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 dark:bg-husk-500/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed right-0 top-0 z-50 h-full w-full sm:w-80 bg-sand-50 dark:bg-husk-200 border-l border-sand-300 dark:border-husk-50 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-sand-300 dark:border-husk-50 px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-coconut-700 dark:text-sand-50">
              Settings
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="Close settings"
                className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* API Key */}
            <Field label="pokemontcg.io API key" htmlFor="apiKey">
              <input
                id="apiKey"
                type="password"
                value={settings.apiKey}
                onChange={(e) => updateSettings({ apiKey: e.target.value })}
                placeholder="Optional — raises rate limit"
                className="w-full rounded-md border border-sand-300 dark:border-coconut-500 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-700 dark:text-sand-50 placeholder:text-coconut-400 dark:text-sand-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
              />
            </Field>

            {/* Tag */}
            <Field label='Source tag (e.g. "binder1")' htmlFor="tag">
              <input
                id="tag"
                type="text"
                value={settings.tag}
                onChange={(e) => updateSettings({ tag: e.target.value })}
                placeholder="Labels rows in the export"
                className="w-full rounded-md border border-sand-300 dark:border-coconut-500 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-700 dark:text-sand-50 placeholder:text-coconut-400 dark:text-sand-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
              />
            </Field>

            {/* Sort order */}
            <Field label="Sort order" htmlFor="sort">
              <select
                id="sort"
                value={settings.sort}
                onChange={(e) => updateSettings({ sort: e.target.value as SortMode })}
                className="w-full rounded-md border border-sand-300 dark:border-coconut-500 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-700 dark:text-sand-50 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-coconut-400 dark:text-sand-300">
                Applied to every export (xlsx, PDF binder, condensed PDF, checklist). Tag stays the
                outermost group; this only changes order within each tag.
              </p>
            </Field>

            {/* Max price */}
            <Field label="Max price cap ($)" htmlFor="maxPrice">
              <input
                id="maxPrice"
                type="number"
                min={0}
                step={1}
                value={settings.maxPrice ?? ''}
                onChange={(e) =>
                  updateSettings({
                    maxPrice: e.target.value ? parseFloat(e.target.value) : null,
                  })
                }
                placeholder="No cap"
                className="w-full rounded-md border border-sand-300 dark:border-coconut-500 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-700 dark:text-sand-50 placeholder:text-coconut-400 dark:text-sand-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
              />
              <p className="mt-1 text-xs text-coconut-400 dark:text-sand-300">
                Bulk top-N results above this price are excluded. Single-card lookups are always
                shown (flagged amber in the export).
              </p>
            </Field>

            {/* Toggles */}
            <div className="space-y-3 pt-1">
              <Toggle
                id="dedupe"
                label="Deduplicate by card ID"
                description="Remove duplicate matched cards across all queries"
                checked={settings.dedupe}
                onChange={(v) => updateSettings({ dedupe: v })}
              />
              <Toggle
                id="noImages"
                label="Hide images"
                description="Skips thumbnails in the table and image embedding in exports — faster and smaller"
                checked={settings.noImages}
                onChange={(v) => updateSettings({ noImages: v })}
              />
              <Toggle
                id="showTimer"
                label="Show lookup timer"
                description="Surfaces wall-clock elapsed time during a run and a total/avg summary after"
                checked={settings.showTimer}
                onChange={(v) => updateSettings({ showTimer: v })}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-sand-300 dark:border-husk-50 px-5 py-4">
            <button
              onClick={resetSettings}
              className="w-full rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
            >
              Restore defaults
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block mb-1.5 text-sm font-medium text-coconut-600 dark:text-sand-200">
        {label}
      </label>
      {children}
    </div>
  )
}

function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer group">
      <div className="relative mt-0.5 flex-shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          className={`w-9 h-5 rounded-full transition-colors ${checked ? 'bg-sun-300 dark:bg-sun-300' : 'bg-sand-300 dark:bg-husk-50'}`}
        />
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </div>
      <div>
        <p className="text-sm text-coconut-600 dark:text-sand-200 group-hover:text-coconut-700 dark:hover:text-sand-50">{label}</p>
        <p className="text-xs text-coconut-400 dark:text-sand-300">{description}</p>
      </div>
    </label>
  )
}
