/**
 * SettingsDrawer — slide-in panel for API key, price cap, and display toggles.
 * Uses the Radix Dialog primitive styled with Tailwind.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Database, RefreshCw, Settings as SettingsIcon, X } from 'lucide-react'
import { fetchCacheStats } from '../api/client'
import { EXPORT_FIELD_LABELS, EXPORT_FIELD_OPTIONS } from '../data/exportFields'
import { useAppStore } from '../store'
import type { CacheStats, Density, ExportField, ExportFormat, SortMode } from '../types'

const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  xlsx: 'xlsx',
  pdf: 'PDF binder',
  'condensed-pdf': 'Condensed PDF',
  checklist: 'Checklist',
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'number', label: 'Card number (group by set) — default' },
  { value: 'number-desc', label: 'Card number, descending' },
  { value: 'price-asc', label: 'Price, ascending' },
  { value: 'price-desc', label: 'Price, descending' },
  { value: 'release-date', label: 'Release date (chronological)' },
  { value: 'alpha', label: 'Card name (alphabetical)' },
]

interface Props {
  /** Lift open state to the parent (the command palette's "Open Settings",
   *  #525). Omit for the usual self-contained trigger-button behavior. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SettingsDrawer({ open: openProp, onOpenChange: onOpenChangeProp }: Props = {}) {
  const { settings, updateSettings, resetSettings } = useAppStore()
  // Controlled only when `open` itself is supplied — a caller passing just
  // one of the pair (e.g. `onOpenChange` alone) would otherwise strand the
  // drawer: falling back open to `internalOpen` while routing writes to the
  // caller's handler (which the caller may not feed back) never updates the
  // value Dialog.Root actually reads. Always notify the caller either way.
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? openProp : internalOpen
  function setOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next)
    onOpenChangeProp?.(next)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2.5 py-1.5 compact:py-1 text-sm text-coconut-600 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors sm:px-3"
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
                className="w-full rounded-md border border-sand-300 dark:border-coconut-500 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-700 dark:text-sand-50 placeholder:text-coconut-400 dark:placeholder:text-sand-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
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
                className="w-full rounded-md border border-sand-300 dark:border-coconut-500 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-700 dark:text-sand-50 placeholder:text-coconut-400 dark:placeholder:text-sand-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
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

            {/* Density (#526) */}
            <Field label="Density" htmlFor="density">
              <select
                id="density"
                value={settings.density}
                onChange={(e) => updateSettings({ density: e.target.value as Density })}
                className="w-full rounded-md border border-sand-300 dark:border-coconut-500 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-700 dark:text-sand-50 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
              >
                <option value="comfortable">Comfortable — default</option>
                <option value="compact">Compact — tighter rows</option>
              </select>
              <p className="mt-1 text-xs text-coconut-400 dark:text-sand-300">
                Compact tightens the results table, Backpack, and header for
                working through long lists.
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
                className="w-full rounded-md border border-sand-300 dark:border-coconut-500 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-700 dark:text-sand-50 placeholder:text-coconut-400 dark:placeholder:text-sand-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
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
              <Toggle
                id="showEbay"
                label="Show eBay comps"
                description="Adds an eBay column with the median sold price and a sparkline of recent sales"
                checked={settings.showEbay}
                onChange={(v) => updateSettings({ showEbay: v })}
              />
              <Toggle
                id="hideOwned"
                label="Hide owned cards"
                description="Drops results you already have in a collection, so the table shows just what's still missing"
                checked={settings.hideOwned}
                onChange={(v) => updateSettings({ hideOwned: v })}
              />
            </div>

            <ExportFieldsSection />

            <CacheStatsPanel />
          </div>

          {/* Footer */}
          <div className="border-t border-sand-300 dark:border-husk-50 px-5 py-4">
            <button
              onClick={resetSettings}
              className="w-full rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-3 py-1.5 text-sm text-coconut-500 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
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

// ---------------------------------------------------------------------------
// Export columns — collapsible per-format field toggles (#262). Collapsed
// by default since most users never need to change the defaults; expanding
// reveals one checkbox group per export format (xlsx / PDF binder /
// condensed PDF / checklist), each listing only the fields that format
// actually supports.
// ---------------------------------------------------------------------------

const EXPORT_FORMATS = Object.keys(EXPORT_FIELD_OPTIONS) as ExportFormat[]

function ExportFieldsSection() {
  const { settings, updateSettings } = useAppStore()

  function toggleField(format: ExportFormat, field: ExportField, checked: boolean) {
    updateSettings({
      exportFields: {
        ...settings.exportFields,
        [format]: { ...settings.exportFields[format], [field]: checked },
      },
    })
  }

  return (
    <details className="group rounded-md border border-sand-300 dark:border-husk-50">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium text-coconut-600 dark:text-sand-200">
        Export columns
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-sand-300 dark:border-husk-50 px-3 py-3">
        {EXPORT_FORMATS.map((format) => (
          <div key={format}>
            <p className="mb-1.5 text-xs font-medium text-coconut-500 dark:text-sand-300">
              {EXPORT_FORMAT_LABELS[format]}
            </p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              {EXPORT_FIELD_OPTIONS[format].map((field) => {
                const id = `export-field-${format}-${field}`
                const checked = settings.exportFields[format]?.[field] ?? true
                return (
                  <label
                    key={field}
                    htmlFor={id}
                    className="flex items-center gap-1.5 text-xs text-coconut-600 dark:text-sand-200 cursor-pointer"
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleField(format, field, e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-sand-300 dark:border-husk-50 text-palm-500 focus:ring-palm-400"
                    />
                    {EXPORT_FIELD_LABELS[field]}
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Cache stats panel — read-only snapshot of GET /api/v1/cache/stats. Lives
// at the bottom of the drawer because it's diagnostic, not configurable.
// ---------------------------------------------------------------------------

function CacheStatsPanel() {
  // `loading` starts true because the mount effect kicks off the first
  // fetch before any user interaction. Refresh-button clicks flip it back
  // on. Keeping the initial setLoading out of the effect avoids the
  // react-hooks/set-state-in-effect lint rule.
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Single mount effect — cancellable so the drawer closing mid-flight
  // doesn't try to update an unmounted component. Matches the pattern in
  // HelpModal.tsx.
  useEffect(() => {
    let cancelled = false
    fetchCacheStats()
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed to load')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setStats(await fetchCacheStats())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-100 dark:bg-husk-100 px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-coconut-600 dark:text-sand-200">
          <Database size={14} />
          Cache stats
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh cache stats"
          className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {!error && !stats && loading && (
        <p className="text-xs text-coconut-400 dark:text-sand-300">Loading…</p>
      )}

      {stats && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
          <StatRow label="API responses" value={`${stats.api_entry_count} · ${formatBytes(stats.api_bytes)}`} />
          <StatRow
            label="Structural"
            value={`${stats.api_structural_entry_count} · ${formatBytes(stats.api_structural_bytes)}`}
          />
          <StatRow
            label="Pricing (24h)"
            value={
              stats.api_pricing_oldest_mtime == null
                ? `${stats.api_pricing_entry_count} · ${formatBytes(stats.api_pricing_bytes)}`
                : `${stats.api_pricing_entry_count} · ${formatBytes(stats.api_pricing_bytes)} · ${formatAge(stats.api_pricing_oldest_mtime)}`
            }
          />
          <StatRow label="Images" value={`${stats.image_entry_count} · ${formatBytes(stats.image_bytes)}`} />
          <StatRow label="URL overrides" value={`${stats.override_count} · ${formatBytes(stats.override_bytes)}`} />
          <StatRow
            label="Concepts"
            value={
              stats.concept_warm_timestamp == null
                ? 'not warmed'
                : `${stats.concept_warm_names} · ${formatAge(stats.concept_warm_timestamp)}`
            }
            warn={stats.concept_warm_timestamp == null}
          />
          <StatRow
            label="Set cards"
            value={
              stats.set_cards_warm_timestamp == null
                ? 'not warmed'
                : `${stats.set_cards_warm_count} · ${formatAge(stats.set_cards_warm_timestamp)}`
            }
            warn={stats.set_cards_warm_timestamp == null}
          />
          <StatRow
            label="Sets"
            value={
              stats.sets_warm_timestamp == null
                ? 'not warmed'
                : `${stats.sets_warm_count} · ${formatAge(stats.sets_warm_timestamp)}`
            }
            warn={stats.sets_warm_timestamp == null}
          />
          <StatRow
            label="Cards"
            value={
              stats.card_warm_timestamp == null
                ? 'not warmed'
                : `${stats.card_warm_count} · ${formatAge(stats.card_warm_timestamp)}`
            }
            warn={stats.card_warm_timestamp == null}
          />
        </dl>
      )}
    </div>
  )
}

function StatRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <dt className="text-coconut-400 dark:text-sand-300 truncate">{label}</dt>
      <dd
        className={`text-right tabular-nums ${
          warn
            ? 'text-sun-700 dark:text-sun-300'
            : 'text-coconut-700 dark:text-sand-50'
        }`}
      >
        {value}
      </dd>
    </>
  )
}

// Mirrors `_format_bytes` in src/mgz_pkmn/cli.py — powers-of-1024 to match
// `du -h`, one decimal once we leave the B range. Now that the per-card
// image warm (#371) routinely lands the image cache in the multi-GB range,
// capping at MB read as "17000.0 MB" instead of "17.5 GB".
function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = n
  for (let i = 0; i < units.length; i++) {
    if (size < 1024 || i === units.length - 1) {
      return units[i] === 'B' ? `${Math.trunc(size)} B` : `${size.toFixed(1)} ${units[i]}`
    }
    size /= 1024
  }
  return `${size.toFixed(1)} ${units[units.length - 1]}`
}

function formatAge(epochSeconds: number): string {
  const seconds = Math.max(0, Date.now() / 1000 - epochSeconds)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
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
