/**
 * ExportBar — a single "Export" dropdown that lists xlsx, standard PDF
 * binder, condensed PDF binder, the per-tag checklist PDF, and the set
 * identification cards PDF.
 *
 * Row-dependent items (xlsx/pdf/condensed-pdf/checklist) are disabled
 * until at least one matched row is available. The Set ID cards item is
 * always enabled — it fetches the full set catalog server-side and
 * doesn't require any input rows.
 *
 * The matched-row count lives at the bottom of the dropdown list so the
 * trigger stays the same size whether or not a run has produced rows;
 * that keeps it aligned with the other header controls.
 */
import { useState } from 'react'
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
import { exportFile } from '../api/client'
import { useAppStore } from '../store'
import type { ExportFormat } from '../types'
import { SetPickerModal } from './SetPickerModal'

const BUTTONS: { format: ExportFormat; label: string; icon: ReactNode }[] = [
  { format: 'xlsx', label: 'Download .xlsx', icon: <FileSpreadsheet size={14} /> },
  { format: 'pdf', label: 'PDF binder', icon: <BookOpen size={14} /> },
  { format: 'condensed-pdf', label: 'Condensed PDF', icon: <LayoutGrid size={14} /> },
  { format: 'checklist', label: 'Checklist', icon: <ListChecks size={14} /> },
]

export function ExportBar() {
  const { rows, settings } = useAppStore()
  const [loading, setLoading] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set ID cards now opens the picker modal rather than firing an
  // immediate download — the modal owns its own loading + error state
  // (including the cross-fetch to /api/v1/sets).
  const [pickerOpen, setPickerOpen] = useState(false)

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
              onSelect={() => setPickerOpen(true)}
              className="flex items-center gap-2 rounded px-2.5 py-2 text-sm text-zinc-200 outline-none data-[highlighted]:bg-zinc-800"
            >
              <Tags size={14} />
              Set ID cards…
            </DropdownMenu.Item>
            {matchedRows.length > 0 && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-zinc-800" />
                <DropdownMenu.Label className="px-2.5 py-1.5 text-xs text-zinc-400">
                  {matchedRows.length} row{matchedRows.length !== 1 ? 's' : ''}
                </DropdownMenu.Label>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {/* Errors live outside the dropdown so they stay visible after the
          user picks a format and the menu closes. */}
      {error && <span className="text-xs text-red-400">{error}</span>}
      <SetPickerModal open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  )
}
