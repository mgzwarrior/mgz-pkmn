/**
 * ResultsTable — displays streamed lookup rows.
 *
 * Each row shows: thumbnail (if available), name, set, rarity,
 * market price, comp tiers (80/85/90/95%), price source, and a link to
 * the listing. Unmatched rows show an amber "not found" badge.
 */
import { useState } from 'react'
import { ExternalLink, AlertCircle } from 'lucide-react'
import { addOverride } from '../api/client'
import { useAppStore } from '../store'
import type { Row } from '../types'

interface Props {
  onRerunLine?: (line: string) => void
}

export function ResultsTable({ onRerunLine }: Props) {
  const { rows, progress, isRunning, settings } = useAppStore()

  if (rows.length === 0 && !isRunning) {
    return (
      <div className="flex items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 py-16 text-zinc-500 text-sm">
        Results will appear here after you run a lookup.
      </div>
    )
  }

  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <div className="flex flex-col gap-2">
      {/* Progress bar */}
      {(isRunning || (progress && progress.done < progress.total)) && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          {progress && (
            <span className="text-xs text-zinc-500 tabular-nums whitespace-nowrap">
              {progress.done} / {progress.total}
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-zinc-700">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-zinc-700 bg-zinc-800 text-left">
              {!settings.noImages && (
                <th className="px-3 py-2 text-xs font-medium text-zinc-400 w-16">Img</th>
              )}
              <th className="px-3 py-2 text-xs font-medium text-zinc-400">Name</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 hidden md:table-cell">Set</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 hidden lg:table-cell">Rarity</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 text-right">Market</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 text-right hidden xl:table-cell">80%</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 text-right hidden xl:table-cell">85%</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 text-right hidden xl:table-cell">90%</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 text-right hidden xl:table-cell">95%</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 hidden sm:table-cell">Source</th>
              <th className="px-3 py-2 text-xs font-medium text-zinc-400 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <ResultRow
                key={i}
                row={row}
                showImage={!settings.noImages}
                onRerunLine={onRerunLine}
              />
            ))}
            {isRunning && (
              <tr>
                <td colSpan={12} className="py-2 px-3">
                  <div className="h-1 w-24 rounded animate-pulse bg-zinc-700" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-600 text-right">
        {rows.filter((r) => r.matched).length} matched · {rows.filter((r) => !r.matched).length}{' '}
        unmatched · {rows.length} total
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------

function fmt(amount: number | null, currency = 'USD'): string {
  if (amount == null) return '—'
  const sym = currency === 'EUR' ? '€' : '$'
  return `${sym}${amount.toFixed(2)}`
}

function comp(market: number | null, pct: number): string {
  return market != null ? fmt((market * pct) / 100) : '—'
}

function ResultRow({
  row,
  showImage,
  onRerunLine,
}: {
  row: Row
  showImage: boolean
  onRerunLine?: (line: string) => void
}) {
  const card = row.card
  const p = row.pricing
  const [showOverrideForm, setShowOverrideForm] = useState(false)
  const [overrideUrl, setOverrideUrl] = useState('')
  const [overrideSaving, setOverrideSaving] = useState(false)

  const imgUrl = card?.images?.small as string | undefined
  const setName = (card?.set as { name?: string } | undefined)?.name
  const isOverCap =
    useAppStore.getState().settings.maxPrice != null &&
    p.market != null &&
    p.market > (useAppStore.getState().settings.maxPrice ?? Infinity)

  async function handleSaveOverride() {
    if (!overrideUrl.trim()) return
    setOverrideSaving(true)
    try {
      await addOverride(row.query.name, row.query.set_hint, overrideUrl.trim())
      setShowOverrideForm(false)
      setOverrideUrl('')
      // Optionally re-run this line
      if (onRerunLine) onRerunLine(row.query.raw)
    } finally {
      setOverrideSaving(false)
    }
  }

  return (
    <>
      <tr
        className={`border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors motion-safe:animate-[fadeInRow_220ms_ease-out] ${
          !row.matched ? 'opacity-60' : ''
        } ${isOverCap ? 'bg-amber-950/30' : ''}`}
      >
        {/* Thumbnail */}
        {showImage && (
          <td className="px-3 py-1.5 w-16">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={card?.name as string}
                className="w-10 h-14 object-contain rounded"
                loading="lazy"
              />
            ) : (
              <div className="w-10 h-14 rounded bg-zinc-800 flex items-center justify-center">
                <span className="text-zinc-600 text-xs">?</span>
              </div>
            )}
          </td>
        )}

        {/* Name */}
        <td className="px-3 py-2 max-w-[200px]">
          {row.matched ? (
            <div>
              <div className="font-medium text-zinc-100 truncate">{card?.name as string}</div>
              <div className="text-xs text-zinc-500 truncate">{row.query.raw}</div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1 text-zinc-400">
                <AlertCircle size={13} className="text-amber-400 flex-shrink-0" />
                <span className="truncate">{row.query.raw}</span>
              </div>
              <button
                onClick={() => setShowOverrideForm((v) => !v)}
                className="mt-0.5 text-xs text-blue-400 hover:text-blue-300 hover:underline"
              >
                + Add PriceCharting URL
              </button>
            </div>
          )}
        </td>

        {/* Set */}
        <td className="px-3 py-2 text-zinc-400 text-xs hidden md:table-cell max-w-[160px]">
          <div className="truncate">{setName ?? '—'}</div>
          {card?.number && (
            <div className="text-zinc-600">#{card.number as string}</div>
          )}
        </td>

        {/* Rarity */}
        <td className="px-3 py-2 text-xs text-zinc-500 hidden lg:table-cell max-w-[120px] truncate">
          {(card?.rarity as string | undefined) ?? '—'}
        </td>

        {/* Market */}
        <td
          className={`px-3 py-2 text-right font-mono tabular-nums ${
            isOverCap ? 'text-amber-400 font-bold' : p.market ? 'text-green-400' : 'text-zinc-600'
          }`}
        >
          {fmt(p.market, p.currency)}
        </td>

        {/* Comp tiers */}
        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 text-xs hidden xl:table-cell">
          {comp(p.market, 80)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 text-xs hidden xl:table-cell">
          {comp(p.market, 85)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 text-xs hidden xl:table-cell">
          {comp(p.market, 90)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400 text-xs hidden xl:table-cell">
          {comp(p.market, 95)}
        </td>

        {/* Price source */}
        <td className="px-3 py-2 text-xs text-zinc-500 hidden sm:table-cell">
          {p.source ?? '—'}
        </td>

        {/* Link */}
        <td className="px-3 py-2 w-8">
          {p.url && (
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-blue-400 transition-colors"
              title="Open listing"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </td>
      </tr>

      {/* Override URL form (inline, expands below row) */}
      {showOverrideForm && (
        <tr className="border-b border-zinc-800 bg-zinc-800/60">
          <td colSpan={12} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={overrideUrl}
                onChange={(e) => setOverrideUrl(e.target.value)}
                placeholder="https://www.pricecharting.com/game/pokemon-…"
                className="flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && handleSaveOverride()}
              />
              <button
                onClick={handleSaveOverride}
                disabled={overrideSaving || !overrideUrl.trim()}
                className="rounded bg-blue-700 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {overrideSaving ? 'Saving…' : 'Save & re-run'}
              </button>
              <button
                onClick={() => setShowOverrideForm(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
