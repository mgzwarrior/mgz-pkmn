/**
 * InputEditor — multi-line textarea that accepts the card-list grammar.
 *
 * The user types (or pastes) one card per line. Blank lines and `# comment`
 * lines are silently skipped by the parser. An inline parse-preview appears
 * while the user types so they can catch mistakes before running a full
 * lookup.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Square, RotateCcw } from 'lucide-react'
import { parseLine } from '../api/client'
import { useAppStore } from '../store'
import type { CardQuery } from '../types'

interface Props {
  onRun: () => void
  onStop: () => void
}

// Very simple parse-preview: call /api/v1/parse for the currently focused line.
function useLineParse(line: string) {
  const [query, setQuery] = useState<CardQuery | null | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      setQuery(null)
      return
    }
    timerRef.current = setTimeout(async () => {
      try {
        const q = await parseLine(trimmed)
        setQuery(q)
      } catch {
        setQuery(null)
      }
    }, 350)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [line])

  return query
}

export function InputEditor({ onRun, onStop }: Props) {
  const { inputText, setInputText, isRunning, clearRows } = useAppStore()
  const [activeLine, setActiveLine] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const parsedPreview = useLineParse(activeLine)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd + Enter → run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!isRunning) onRun()
      }
    },
    [isRunning, onRun],
  )

  const handleSelectionChange = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart
    const before = el.value.slice(0, pos)
    const lineStart = before.lastIndexOf('\n') + 1
    const lineEnd = el.value.indexOf('\n', pos)
    const line = el.value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    setActiveLine(line)
  }, [])

  const lineCount = inputText.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">
          {lineCount > 0 ? `${lineCount} card line${lineCount !== 1 ? 's' : ''}` : 'Enter card lines below'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              clearRows()
              setInputText('')
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
            title="Clear input and results"
          >
            <RotateCcw size={12} />
            Clear
          </button>
          {isRunning ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 transition-colors"
            >
              <Square size={13} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              onClick={onRun}
              disabled={lineCount === 0}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Play size={13} fill="currentColor" />
              Look up&nbsp;
              <span className="opacity-70 text-xs">(⌘↵)</span>
            </button>
          )}
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onKeyDown={handleKeyDown}
        onSelect={handleSelectionChange}
        onClick={handleSelectionChange}
        spellCheck={false}
        rows={12}
        placeholder={`One card per line, e.g.:\nCharizard | Base Set | 4/102\nPikachu | Jungle\ntop:5 Charizard cards\nMew ex | Scarlet & Violet`}
        className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      {/* Parse preview for the active line */}
      {parsedPreview && (
        <div className="rounded-md border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
          <span className="text-zinc-500">Parsed: </span>
          <span className="text-zinc-200 font-medium">{parsedPreview.name}</span>
          {parsedPreview.set_hint && (
            <span className="text-zinc-400"> · {parsedPreview.set_hint}</span>
          )}
          {parsedPreview.number && (
            <span className="text-zinc-500"> #{parsedPreview.number}</span>
          )}
          {parsedPreview.bulk_top && (
            <span className="text-blue-400"> (top {parsedPreview.bulk_top})</span>
          )}
          {parsedPreview.variant_hint && (
            <span className="text-amber-400"> [{parsedPreview.variant_hint}]</span>
          )}
        </div>
      )}
    </div>
  )
}
