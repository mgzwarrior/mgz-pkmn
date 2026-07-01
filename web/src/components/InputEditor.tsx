/**
 * InputEditor — multi-line textarea that accepts the card-list grammar.
 *
 * The user types (or pastes) one card per line. Blank lines and `# comment`
 * lines are silently skipped by the parser. An inline parse-preview appears
 * while the user types so they can catch mistakes before running a full
 * lookup.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Play, Square, RotateCcw } from 'lucide-react'
import { parseLine } from '../api/client'
import { useAppStore } from '../store'
import type { CardQuery } from '../types'
import { LookupTimer } from './LookupTimer'
import { CacheSourceChip } from './CacheSourceChip'

interface Props {
  onRun: (overrideText?: string) => void
  onStop: () => void
}

const EXAMPLE_QUERIES = [
  'Charizard | Base Set | 4/102',
  'Pikachu | Jungle',
  'Squirtle | 7/102',
  'Mew ex',
  'Charizard [holo]',
  'top:5 Charizard cards',
  'All Charizard cards | Base Set',
  'Pikachu >=20 <=50',
]

// Tracks how much the on-screen keyboard eats into the layout viewport so a
// pinned toolbar can sit just above it instead of underneath it (iOS Safari
// doesn't shrink the layout viewport for the keyboard, so `fixed` elements
// need the visualViewport offset to stay clear of it).
function useKeyboardInset(active: boolean) {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (!active || typeof window === 'undefined' || !window.visualViewport) return
    const vv = window.visualViewport
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    const raf = requestAnimationFrame(update)
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setInset(0)
    }
  }, [active])

  return inset
}

// Very simple parse-preview: call /api/v1/parse for the currently focused line.
function useLineParse(line: string) {
  const trimmed = line.trim()
  const skip = !trimmed || trimmed.startsWith('#')
  const [query, setQuery] = useState<CardQuery | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (skip) return
    let cancelled = false
    timerRef.current = setTimeout(async () => {
      try {
        const q = await parseLine(trimmed)
        if (!cancelled) setQuery(q)
      } catch {
        if (!cancelled) setQuery(null)
      }
    }, 350)
    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [trimmed, skip])

  return skip ? null : query
}

export function InputEditor({ onRun, onStop }: Props) {
  const { inputText, setInputText, isRunning, clearRows } = useAppStore()
  const [activeLine, setActiveLine] = useState('')
  const [isTextareaFocused, setIsTextareaFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const parsedPreview = useLineParse(activeLine)
  const keyboardInset = useKeyboardInset(isTextareaFocused)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
  const isEmpty = inputText.trim() === ''

  const handleChipClick = useCallback(
    (example: string) => {
      if (isRunning) return
      setInputText(example)
      onRun(example)
    },
    [isRunning, setInputText, onRun],
  )

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar. Pinned above the on-screen keyboard while the textarea is
          focused on a touch device (pointer-fine devices keep the normal
          in-flow layout — there's no keyboard fighting for space). */}
      <div
        className={
          isTextareaFocused
            ? 'flex items-center justify-between gap-2 pointer-coarse:fixed pointer-coarse:inset-x-0 pointer-coarse:z-40 pointer-coarse:border-t pointer-coarse:border-sand-300 pointer-coarse:bg-sand-50 pointer-coarse:px-4 pointer-coarse:py-2 pointer-coarse:shadow-2xl dark:pointer-coarse:border-husk-50 dark:pointer-coarse:bg-husk-200'
            : 'flex items-center justify-between'
        }
        style={isTextareaFocused ? { bottom: keyboardInset } : undefined}
      >
        <span className="text-xs text-coconut-400 dark:text-sand-300">
          {lineCount > 0 ? `${lineCount} card line${lineCount !== 1 ? 's' : ''}` : 'Enter card lines below'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              clearRows()
              setInputText('')
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-coconut-400 hover:text-coconut-700 hover:bg-sand-200 dark:text-sand-300 dark:hover:text-sand-50 dark:hover:bg-husk-100 transition-colors"
            title="Clear input and results"
          >
            <RotateCcw size={12} />
            Clear
          </button>
          {isRunning ? (
            <button
              onPointerDown={(e) => e.preventDefault()}
              onClick={onStop}
              className="flex items-center gap-1.5 rounded-md bg-ember-500 px-3 py-1.5 text-sm font-medium text-sand-50 hover:bg-ember-400 dark:bg-ember-500 dark:hover:bg-ember-400 transition-colors"
            >
              <Square size={13} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onRun()}
              disabled={lineCount === 0}
              data-tour="run"
              className="flex items-center gap-1.5 rounded-md bg-sun-300 px-3 py-1.5 text-sm font-medium text-coconut-700 shadow-sm hover:bg-sun-400 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Play size={13} fill="currentColor" />
              Look up&nbsp;
              <span className="text-xs opacity-80 hidden pointer-fine:inline">(⌘↵)</span>
            </button>
          )}
        </div>
      </div>

      {/* Optional lookup-timer readout + cache-source chip (settings-gated).
          Sits under the toolbar so it's adjacent to the Look up / Stop button. */}
      <div className="flex items-center justify-end gap-3">
        <CacheSourceChip />
        <LookupTimer />
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        aria-label="Card list — one card per line"
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onKeyDown={handleKeyDown}
        onSelect={handleSelectionChange}
        onClick={handleSelectionChange}
        onFocus={() => setIsTextareaFocused(true)}
        onBlur={() => setIsTextareaFocused(false)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={12}
        placeholder={`One card per line, e.g.:\nCharizard | Base Set | 4/102\nPikachu | Jungle\ntop:5 Charizard cards\nMew ex | Scarlet & Violet`}
        className="w-full resize-y rounded-md border border-sand-300 bg-sand-50 px-3 py-2.5 font-mono text-sm text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-50 dark:bg-husk-200 dark:text-sand-50 dark:placeholder:text-sand-500 dark:focus:ring-sun-300"
      />

      {/* Example query chips — guided empty-state */}
      {isEmpty && !isRunning && (
        <div className="flex flex-col gap-2 rounded-md border border-sand-300 bg-sand-100 dark:border-husk-50 dark:bg-husk-200/40 px-3 py-3">
          <span className="text-xs text-coconut-400 dark:text-sand-300">Try one of these</span>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example}
                onClick={() => handleChipClick(example)}
                className="rounded-full border border-sand-300 bg-sand-50 px-2.5 py-1 font-mono text-xs text-coconut-600 hover:border-palm-400 hover:bg-sand-200 hover:text-coconut-700 dark:border-husk-50 dark:bg-husk-300 dark:text-sand-200 dark:hover:border-sun-300 dark:hover:bg-husk-100 dark:hover:text-sand-50 transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Parse preview for the active line */}
      {parsedPreview && (
        <div className="rounded-md border border-sand-300 bg-sand-100 dark:border-husk-50 dark:bg-husk-200/60 px-3 py-2 text-xs text-coconut-400 dark:text-sand-300">
          <span className="text-coconut-400 dark:text-sand-400">Parsed: </span>
          <span className="text-coconut-700 dark:text-sand-50 font-medium">{parsedPreview.name}</span>
          {parsedPreview.set_hint && (
            <span className="text-coconut-400 dark:text-sand-300"> · {parsedPreview.set_hint}</span>
          )}
          {parsedPreview.number && (
            <span className="text-coconut-400 dark:text-sand-400"> #{parsedPreview.number}</span>
          )}
          {parsedPreview.bulk_all ? (
            <span className="text-palm-500 dark:text-sun-300"> (all)</span>
          ) : parsedPreview.bulk_top ? (
            <span className="text-palm-500 dark:text-sun-300"> (top {parsedPreview.bulk_top})</span>
          ) : null}
          {parsedPreview.variant_hint && (
            <span className="text-sun-600 dark:text-sun-300"> [{parsedPreview.variant_hint}]</span>
          )}
        </div>
      )}
    </div>
  )
}
