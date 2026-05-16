/**
 * ExportBar — download buttons for xlsx, standard PDF binder, condensed PDF
 * binder, the per-tag checklist PDF, and the set identification cards PDF.
 *
 * Row-dependent buttons (xlsx/pdf/condensed-pdf/checklist) are disabled
 * until at least one matched row is available. The Set ID cards button
 * is always enabled — it fetches the full set catalog server-side and
 * doesn't require any input rows.
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
} from 'lucide-react'
import { downloadSetCardsPdf, exportFile } from '../api/client'
import { useAppStore } from '../store'
import type { ExportFormat } from '../types'

const BUTTONS: { format: ExportFormat; label: string; icon: ReactNode }[] = [
  { format: 'xlsx', label: 'Download .xlsx', icon: <FileSpreadsheet size={14} /> },
  { format: 'pdf', label: 'PDF binder', icon: <BookOpen size={14} /> },
  { format: 'condensed-pdf', label: 'Condensed PDF', icon: <LayoutGrid size={14} /> },
  { format: 'checklist', label: 'Checklist', icon: <ListChecks size={14} /> },
]

export function ExportBar() {
  const { rows, settings } = useAppStore()
  const [loading, setLoading] = useState<ExportFormat | 'set-cards' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const matchedRows = rows.filter((r) => r.matched)
  const disabled = matchedRows.length === 0

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

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {BUTTONS.map((b) => (
        <ExportButton
          key={b.format}
          label={b.label}
          icon={b.icon}
          loading={loading === b.format}
          disabled={disabled || loading !== null}
          onClick={() => handleExport(b.format)}
        />
      ))}
      <ExportButton
        label="Set ID cards"
        icon={<Tags size={14} />}
        loading={loading === 'set-cards'}
        disabled={loading !== null}
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
