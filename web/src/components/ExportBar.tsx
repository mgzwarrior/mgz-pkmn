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
  IdCard,
  Loader2,
  Download,
  ChevronDown,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { downloadCollectionIdCardPdf, exportFile } from '../api/client'
import { enabledFields } from '../data/exportFields'
import { useAppStore } from '../store'
import type { ExportFormat, Row } from '../types'
import { SetPickerModal } from './SetPickerModal'

interface ExportBarProps {
  /** Rows to export. Omit to use the Search store's current run (the default
   *  results-header behavior); the collection / want-list detail views pass
   *  their own items (#773). */
  rows?: Row[]
  /** Filename / sheet title. Falls back to the Search tag, then "cards". */
  title?: string
  /** Whether to offer the "Set ID cards…" item — search-only, since it pulls a
   *  whole set catalog rather than the listed rows. Defaults to true. */
  showSetIdCards?: boolean
  /** When set, offers a "Collection ID card" item that downloads that
   *  collection's printable ID card (#507) — the customizable cover cutout,
   *  as a first-class export choice alongside the row-based formats (#788). */
  collectionId?: number
}

const BUTTONS: { format: ExportFormat; label: string; icon: ReactNode }[] = [
  { format: 'xlsx', label: 'Download .xlsx', icon: <FileSpreadsheet size={14} /> },
  { format: 'pdf', label: 'PDF binder', icon: <BookOpen size={14} /> },
  { format: 'condensed-pdf', label: 'Condensed PDF', icon: <LayoutGrid size={14} /> },
  { format: 'checklist', label: 'Checklist', icon: <ListChecks size={14} /> },
]

export function ExportBar({
  rows: rowsProp,
  title,
  showSetIdCards = true,
  collectionId,
}: ExportBarProps = {}) {
  const { rows: storeRows, settings } = useAppStore()
  const [loading, setLoading] = useState<ExportFormat | 'id-card' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set ID cards now opens the picker modal rather than firing an
  // immediate download — the modal owns its own loading + error state
  // (including the cross-fetch to /api/v1/sets).
  const [pickerOpen, setPickerOpen] = useState(false)

  // Caller-supplied rows (a collection / want-list) win over the Search run.
  const sourceRows = rowsProp ?? storeRows
  const matchedRows = sourceRows.filter((r) => r.matched)
  const disabled = matchedRows.length === 0
  const anyLoading = loading !== null

  async function handleExport(format: ExportFormat) {
    if (disabled) return
    setLoading(format)
    setError(null)
    try {
      await exportFile(sourceRows, format, {
        maxPrice: settings.maxPrice,
        title: title ?? (settings.tag || 'cards'),
        sort: settings.sort,
        noImages: settings.noImages,
        dedupe: settings.dedupe,
        fields: enabledFields(settings.exportFields[format]),
        leadWithIdCard: settings.leadWithIdCard,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(null)
    }
  }

  async function handleIdCard() {
    if (collectionId == null) return
    setLoading('id-card')
    setError(null)
    try {
      await downloadCollectionIdCardPdf(collectionId, settings.apiKey || undefined)
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
            className="flex items-center gap-1.5 rounded-md border border-sand-300 bg-sand-100 px-3 py-1.5 text-sm text-coconut-700 hover:bg-sand-200 hover:border-sand-400 dark:border-husk-50 dark:bg-husk-200 dark:text-sand-50 dark:hover:bg-husk-100 dark:hover:border-coconut-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
            className="z-50 min-w-[200px] rounded-md border border-sand-300 bg-sand-50 dark:border-husk-50 dark:bg-husk-200 p-1 shadow-xl shadow-coconut-700/15"
          >
            {BUTTONS.map((b) => (
              <DropdownMenu.Item
                key={b.format}
                disabled={disabled}
                onSelect={() => handleExport(b.format)}
                className="flex items-center gap-2 rounded px-2.5 py-2 text-sm text-coconut-700 dark:text-sand-50 outline-none data-[highlighted]:bg-sand-200 dark:data-[highlighted]:bg-husk-100 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
              >
                {b.icon}
                {b.label}
              </DropdownMenu.Item>
            ))}
            {showSetIdCards && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-sand-200 dark:bg-husk-100" />
                <DropdownMenu.Item
                  onSelect={() => setPickerOpen(true)}
                  className="flex items-center gap-2 rounded px-2.5 py-2 text-sm text-coconut-700 dark:text-sand-50 outline-none data-[highlighted]:bg-sand-200 dark:data-[highlighted]:bg-husk-100"
                >
                  <Tags size={14} />
                  Set ID cards…
                </DropdownMenu.Item>
              </>
            )}
            {collectionId != null && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-sand-200 dark:bg-husk-100" />
                <DropdownMenu.Item
                  onSelect={() => void handleIdCard()}
                  className="flex items-center gap-2 rounded px-2.5 py-2 text-sm text-coconut-700 dark:text-sand-50 outline-none data-[highlighted]:bg-sand-200 dark:data-[highlighted]:bg-husk-100"
                >
                  {loading === 'id-card' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <IdCard size={14} />
                  )}
                  Collection ID card
                </DropdownMenu.Item>
              </>
            )}
            {matchedRows.length > 0 && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-sand-200 dark:bg-husk-100" />
                <DropdownMenu.Label className="px-2.5 py-1.5 text-xs text-coconut-400 dark:text-sand-300">
                  {matchedRows.length} row{matchedRows.length !== 1 ? 's' : ''}
                </DropdownMenu.Label>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {/* Errors live outside the dropdown so they stay visible after the
          user picks a format and the menu closes. */}
      {error && <span className="text-xs text-ember-500 dark:text-ember-300">{error}</span>}
      {showSetIdCards && <SetPickerModal open={pickerOpen} onOpenChange={setPickerOpen} />}
    </div>
  )
}
