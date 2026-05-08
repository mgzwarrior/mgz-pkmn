/**
 * ExportBar — "Download .xlsx" and "Download PDF binder" buttons.
 *
 * Disabled until at least one matched row is available.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { FileSpreadsheet, BookOpen, Loader2 } from 'lucide-react'
import { exportFile } from '../api/client'
import { useAppStore } from '../store'

export function ExportBar() {
  const { rows, settings } = useAppStore()
  const [loadingXlsx, setLoadingXlsx] = useState(false)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matchedRows = rows.filter((r) => r.matched)
  const disabled = matchedRows.length === 0

  async function handleExport(format: 'xlsx' | 'pdf') {
    if (disabled) return
    const setter = format === 'xlsx' ? setLoadingXlsx : setLoadingPdf
    setter(true)
    setError(null)
    try {
      await exportFile(rows, format, {
        maxPrice: settings.maxPrice,
        title: settings.tag || 'cards',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setter(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <ExportButton
        label="Download .xlsx"
        icon={<FileSpreadsheet size={14} />}
        loading={loadingXlsx}
        disabled={disabled}
        onClick={() => handleExport('xlsx')}
      />
      <ExportButton
        label="Download PDF binder"
        icon={<BookOpen size={14} />}
        loading={loadingPdf}
        disabled={disabled}
        onClick={() => handleExport('pdf')}
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
