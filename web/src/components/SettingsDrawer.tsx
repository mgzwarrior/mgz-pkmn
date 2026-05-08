/**
 * SettingsDrawer — slide-in panel for API key, price cap, and display toggles.
 * Uses the Radix Dialog primitive styled with Tailwind.
 */
import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { Settings as SettingsIcon, X } from 'lucide-react'
import { useAppStore } from '../store'

export function SettingsDrawer() {
  const { settings, updateSettings } = useAppStore()

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
          title="Settings"
        >
          <SettingsIcon size={15} />
          Settings
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed right-0 top-0 z-50 h-full w-80 bg-zinc-900 border-l border-zinc-700 shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-zinc-100">
              Settings
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors">
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
                className="w-full rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                className="w-full rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
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
                className="w-full rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-zinc-500">
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
                label="Hide images in results"
                description="Speeds up the table but hides thumbnails"
                checked={settings.noImages}
                onChange={(v) => updateSettings({ noImages: v })}
              />
            </div>
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
      <label htmlFor={htmlFor} className="block mb-1.5 text-sm font-medium text-zinc-300">
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
          className={`w-9 h-5 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-zinc-600'}`}
        />
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </div>
      <div>
        <p className="text-sm text-zinc-200 group-hover:text-zinc-100">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
    </label>
  )
}
