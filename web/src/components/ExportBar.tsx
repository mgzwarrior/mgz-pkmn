/**
 * ExportBar — download buttons for xlsx, standard PDF binder, condensed PDF
 * binder, the per-tag checklist PDF, and the set identification cards PDF.
 *
 * Row-dependent buttons (xlsx/pdf/condensed-pdf/checklist) are disabled
 * until at least one matched row is available. The Set ID cards button
 * is always enabled — it fetches the full set catalog server-side and
 * doesn't require any input rows.
 *
 * On screens below `sm` (640px) the row collapses into a single
 * "Export" dropdown to keep the header compact. Only one tree (desktop
 * or mobile) is mounted at a time, driven by a matchMedia subscription,
 * so tests and the dropdown Portal don't have to fight CSS visibility
 * rules to know which copy of a label is "real".
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FileSpreadsheet,
  BookOpen,
  LayoutGrid,
  ListChecks,
  Tags,
  Loader2,
  Download,
  ChevronDown,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { downloadSetCardsPdf, exportFile } from '../api/client'
import { useAppStore } from '../store'
import type { ExportFormat } from '../types'

const BUTTONS: { format: ExportFormat; label: string; icon: ReactNode }[] = [
  { format: 'xlsx', label: 'Download .xlsx', icon: <FileSpreadsheet size={14} /> },
  { format: 'pdf', label: 'PDF binder', icon: <BookOpen size={14} /> },
  { format: 'condensed-pdf', label: 'Condensed PDF', icon: <LayoutGrid size={14} /> },
  { format: 'checklist', label: 'Checklist', icon: <ListChecks size={14} /> },
]

// Matches Tailwind's `sm` breakpoint (640px). Anything below is mobile.
const MOBILE_QUERY = '(max-width: 639px)'

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(MOBILE_QUERY).matches
  })
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

export function ExportBar() {
  const { rows, settings } = useAppStore()
  const [loading, setLoading] = useState<ExportFormat | 'set-cards' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isMobile = useIsMobile()

  const matchedRows = rows.filter((r) => r.matched)
  const disabled = matchedRows.length === 0
  const anyLoading = loading !== null

  async function handleExport(format: ExportFormat) {
    if (disabled) return
    setLoading(format)
    setError(null)
    try {
      await exportFile(rows, format, {
        maxPrice: settings.maxPrice,
        title: settings.tag || 'cards',
        sort: settings.sort,
        noImages: settings.noImages,
        dedupe: settings.dedupe,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(null)
    }
  }

  async function handleSetCards() {
    setLoading('set-cards')
    setError(null)
    try {
      await downloadSetCardsPdf(settings.apiKey || undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(null)
    }
  }

  if (isMobile) {
    return (
      <div className="flex flex-col items-end gap-1">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={anyLoading}
              aria-label="Export"
            >
              {anyLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Export
              <ChevronDown size={13} className="opacity-70" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-[200px] rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
            >
              {BUTTONS.map((b) => (
                <DropdownMenu.Item
                  key={b.format}
                  disabled={disabled}
                  onSelect={() => handleExport(b.format)}
                  className="flex items-center gap-2 rounded px-2.5 py-2 text-sm text-zinc-200 outline-none data-[highlighted]:bg-zinc-800 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
                >
                  {b.icon}
                  {b.label}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="my-1 h-px bg-zinc-800" />
              <DropdownMenu.Item
                onSelect={handleSetCards}
                className="flex items-center gap-2 rounded px-2.5 py-2 text-sm text-zinc-200 outline-none data-[highlighted]:bg-zinc-800"
              >
                <Tags size={14} />
                Set ID cards
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {/* Status / error lives outside the dropdown menu so it stays
            visible after the user picks a format and the menu closes. */}
        {matchedRows.length > 0 && !disabled && !error && (
          <span className="text-xs text-zinc-500">
            {matchedRows.length} row{matchedRows.length !== 1 ? 's' : ''}
          </span>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {BUTTONS.map((b) => (
        <ExportButton
          key={b.format}
          label={b.label}
          icon={b.icon}
          loading={loading === b.format}
          disabled={disabled || anyLoading}
          onClick={() => handleExport(b.format)}
        />
      ))}
      <ExportButton
        label="Set ID cards"
        icon={<Tags size={14} />}
        loading={loading === 'set-cards'}
        disabled={anyLoading}
        onClick={handleSetCards}
      />
      {matchedRows.length > 0 && !disabled && (
        <span className="text-xs text-zinc-500 ml-1">
          {matchedRows.length} row{matchedRows.length !== 1 ? 's' : ''}
        </span>
      )}
      {error && <span className="text-xs text-red-400 ml-1">{error}</span>}
    </div>
  )
}

function ExportButton({
  label,
  icon,
  loading,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactNode
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}
