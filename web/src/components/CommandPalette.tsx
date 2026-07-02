/**
 * CommandPalette — `Cmd/Ctrl+K` command palette for keyboard-driven power
 * users (#525). Collapses *navigate + invoke* into one interaction: jump to
 * any saved search by name, switch discovery mode, run an export, or open
 * Settings / Help / Collections / Wishlists — all without reaching for the
 * header.
 *
 * The shortcut always intercepts, even while the card-list textarea is
 * focused — unlike the codebase's other global shortcuts (Tour, Swipe's
 * arrow keys), which back off while typing. A command palette is expected to
 * open from anywhere, and the required modifier key means it can't collide
 * with ordinary typing the way a bare key would.
 *
 * No `@radix-ui/react-command`/`cmdk` dependency — hand-rolled on top of the
 * `Dialog` primitive already used elsewhere (`SettingsDrawer`,
 * `HelpModal`, `ResultsTable`'s `MobileFiltersSheet`), matching the
 * project's convention of Radix primitive + hand-styled Tailwind over a
 * higher-level pre-built widget.
 *
 * Collections and want-lists are one merged "Binders" surface in this
 * product ([LibraryBindersTab](./LibraryBindersTab.tsx)) — "Open Collections"
 * and "Open Wishlists" both land there; they're offered as two labels so
 * fuzzy search finds either term.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  BookOpen,
  Bookmark,
  CircleHelp,
  FileSpreadsheet,
  GalleryHorizontalEnd,
  Heart,
  Layers,
  LayoutGrid,
  Library,
  ListChecks,
  Loader2,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react'
import { exportFile, listRuns } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import type { DiscoveryMode } from '../App'
import type { ExportFormat } from '../types'
import { loadSavedRun } from './loadSavedRun'
import { fuzzyScore, readRecentCommandIds, recordRecentCommandId } from './commandPaletteMatch'

interface Props {
  mode: DiscoveryMode
  onSetMode: (mode: DiscoveryMode) => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  onOpenLibrary: () => void
}

interface PaletteCommand {
  id: string
  group: string
  label: string
  hint?: string
  icon: typeof Search
  disabled?: boolean
  run: () => void | Promise<void>
}

const MODE_OPTIONS: { value: DiscoveryMode; label: string; icon: typeof Search }[] = [
  { value: 'swipe', label: 'Swipe', icon: Layers },
  { value: 'browse', label: 'Browse', icon: GalleryHorizontalEnd },
  { value: 'search', label: 'Search', icon: Search },
]

const EXPORT_OPTIONS: { format: ExportFormat; label: string; icon: typeof Search }[] = [
  { format: 'xlsx', label: 'Export: Download .xlsx', icon: FileSpreadsheet },
  { format: 'pdf', label: 'Export: PDF binder', icon: BookOpen },
  { format: 'condensed-pdf', label: 'Export: Condensed PDF', icon: LayoutGrid },
  { format: 'checklist', label: 'Export: Checklist', icon: ListChecks },
]

interface ScoredCommand {
  command: PaletteCommand
  score: number
}

// Duck-typed rather than `instanceof Promise` so a thenable that isn't a
// native Promise (unlikely here, but cheap to handle correctly) still gets
// awaited instead of treated as a synchronous, already-finished command.
function isThenable(value: unknown): value is PromiseLike<void> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

export function CommandPalette({ mode, onSetMode, onOpenSettings, onOpenHelp, onOpenLibrary }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [asyncError, setAsyncError] = useState<string | null>(null)
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentCommandIds())
  const inputRef = useRef<HTMLInputElement>(null)

  const auth = useAuth()
  const runs = useAppStore((s) => s.runs)
  const setRuns = useAppStore((s) => s.setRuns)
  const rows = useAppStore((s) => s.rows)
  const settings = useAppStore((s) => s.settings)

  // `Cmd/Ctrl+K` always intercepts (see module doc for why there's no
  // input-focus guard here, unlike the app's other global shortcuts).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return
      // Held-down key repeat would otherwise rapid-toggle open/closed.
      if (e.repeat) return
      e.preventDefault()
      setOpen((was) => {
        if (was) {
          setQuery('')
          setAsyncError(null)
        }
        return !was
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Saved searches normally load into the store via the Backpack sidebar's
  // own fetch, but a keyboard-only session may never have expanded it — and
  // that sidebar fetch is the only thing that currently refreshes `runs` on
  // a user switch, so a mouse-free session would otherwise keep showing the
  // previous user's cached list forever. `runs` carries no marker of which
  // identity it was fetched for, and a user switch can happen without the
  // palette ever having been open in between, so a pre-populated list can't
  // be trusted just because it's non-empty — fetch fresh the first time
  // this component observes each resolved identity (tracked in a ref) and
  // whenever it changes, accepting a redundant request on a session where
  // the sidebar already fetched correctly as the cost of never leaking one
  // user's saved-search names to another.
  const fetchedForUserRef = useRef<string | null>(null)
  useEffect(() => {
    if (!open) return
    if (auth.loading || (auth.authEnabled && auth.user === null)) return
    const userKey = String(auth.user?.id ?? 'self-host')
    if (fetchedForUserRef.current === userKey) return
    let cancelled = false
    void listRuns(50)
      .then(({ items }) => {
        if (cancelled) return
        setRuns(items)
        fetchedForUserRef.current = userKey
      })
      .catch(() => {
        // Best-effort — Jump-to-search just shows nothing if this fails;
        // the Backpack sidebar's own fetch (with its own error UI) still
        // exists as the primary path.
      })
    return () => {
      cancelled = true
    }
  }, [open, auth.loading, auth.authEnabled, auth.user, setRuns])

  // `rows` updates frequently while a bulk lookup streams in, and this
  // component stays mounted (and subscribed) whether or not the palette is
  // open — skip the filter() pass entirely while closed, since the export
  // commands' disabled state it feeds isn't visible anyway.
  const matchedRowCount = useMemo(
    () => (open ? rows.filter((r) => r.matched).length : 0),
    [open, rows],
  )
  const isRunning = useAppStore((s) => s.isRunning)

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = []

    // Signed-out on an auth-enabled deploy has no identified user — same
    // gate LibrarySearchesTab and LibraryPanel's Binders tab already apply.
    // `runs` also stays cached in the store across sign-out (only
    // `auth.user` clears), so this doubles as the leak guard for a
    // previous or different signed-in user's saved-search names.
    const showUserScoped = !(auth.authEnabled && auth.user === null)
    if (showUserScoped) {
      for (const run of runs) {
        const label = run.name ?? `Run #${run.id}`
        list.push({
          id: `jump:${run.id}`,
          group: 'Jump to a saved search',
          label,
          hint: `${run.row_count} card${run.row_count === 1 ? '' : 's'}`,
          icon: Bookmark,
          // Same guard the Backpack's own saved-search rows apply — loading
          // one mid-stream would clobber the in-flight run's rows out from
          // under the SSE handler still appending to them.
          disabled: isRunning,
          run: () => loadSavedRun(run, () => onSetMode('search')),
        })
      }
    }

    for (const opt of MODE_OPTIONS) {
      list.push({
        id: `mode:${opt.value}`,
        group: 'Switch mode',
        label: opt.label,
        hint: opt.value === mode ? 'Current' : undefined,
        icon: opt.icon,
        run: () => onSetMode(opt.value),
      })
    }

    for (const opt of EXPORT_OPTIONS) {
      list.push({
        id: `export:${opt.format}`,
        group: 'Export',
        label: opt.label,
        disabled: matchedRowCount === 0,
        icon: opt.icon,
        run: () =>
          exportFile(rows, opt.format, {
            maxPrice: settings.maxPrice,
            title: settings.tag || 'cards',
            sort: settings.sort,
            noImages: settings.noImages,
            dedupe: settings.dedupe,
          }),
      })
    }

    list.push(
      { id: 'open:settings', group: 'Open', label: 'Open Settings', icon: SettingsIcon, run: onOpenSettings },
      { id: 'open:help', group: 'Open', label: 'Open Help', icon: CircleHelp, run: onOpenHelp },
    )
    // Signed-out on an auth-enabled deploy has no Binders tab to land on
    // (LibraryPanel filters it out of the tab list) — offering these would
    // advertise an action that can't reach the surface it names.
    if (showUserScoped) {
      list.push(
        { id: 'open:collections', group: 'Open', label: 'Open Collections', icon: Library, run: onOpenLibrary },
        { id: 'open:wishlists', group: 'Open', label: 'Open Wishlists', icon: Heart, run: onOpenLibrary },
      )
    }

    return list
  }, [
    runs,
    auth.authEnabled,
    auth.user,
    isRunning,
    mode,
    onSetMode,
    matchedRowCount,
    rows,
    settings,
    onOpenSettings,
    onOpenHelp,
    onOpenLibrary,
  ])

  const filtered = useMemo<ScoredCommand[]>(() => {
    const q = query.trim()
    if (!q) {
      const rank = new Map(recentIds.map((id, i) => [id, i]))
      const recent = commands
        .filter((c) => rank.has(c.id))
        .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
      const rest = commands.filter((c) => !rank.has(c.id))
      return [...recent, ...rest].map((command) => ({ command, score: 0 }))
    }
    return commands
      .map((command) => ({ command, score: fuzzyScore(q, command.label) }))
      .filter((entry): entry is ScoredCommand => entry.score !== null)
      .sort((a, b) => b.score - a.score)
  }, [commands, query, recentIds])

  // Reset the highlighted row to the first enabled entry whenever the
  // filtered list changes (query edits, or fresh saved-search/export data
  // landing) — an index into the old list would point at the wrong row, or
  // out of range, once the list reshuffles. Done during render (React's
  // "adjust state on a change" pattern, mirroring ResultsTable's sort/filter
  // handling) rather than an effect, so there's no extra commit.
  const [prevFiltered, setPrevFiltered] = useState(filtered)
  if (filtered !== prevFiltered) {
    setPrevFiltered(filtered)
    const firstEnabled = filtered.findIndex((f) => !f.command.disabled)
    setActiveIndex(firstEnabled === -1 ? 0 : firstEnabled)
  }

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setAsyncError(null)
  }, [])

  const invoke = useCallback(
    (command: PaletteCommand) => {
      if (command.disabled || busyId) return
      let result: void | PromiseLike<void>
      try {
        result = command.run()
      } catch (e) {
        // A command callback throwing synchronously (a bug in one of the
        // App-level handlers, say) shouldn't crash the palette — surface it
        // the same way an async command's rejection does.
        setAsyncError(e instanceof Error ? e.message : String(e))
        return
      }
      if (isThenable(result)) {
        setBusyId(command.id)
        setAsyncError(null)
        Promise.resolve(result)
          .then(() => {
            setRecentIds(recordRecentCommandId(command.id))
            close()
          })
          .catch((e: unknown) => {
            setAsyncError(e instanceof Error ? e.message : String(e))
          })
          .finally(() => setBusyId(null))
      } else {
        setRecentIds(recordRecentCommandId(command.id))
        close()
      }
    },
    [busyId, close],
  )

  function moveActive(direction: 1 | -1) {
    setActiveIndex((current) => {
      if (filtered.length === 0) return current
      let next = current
      for (let step = 0; step < filtered.length; step++) {
        next = (next + direction + filtered.length) % filtered.length
        if (!filtered[next].command.disabled) return next
      }
      return current
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveActive(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveActive(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = filtered[activeIndex]
      if (entry) invoke(entry.command)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
          className="fixed left-1/2 top-[15vh] z-50 flex max-h-[70vh] w-[min(560px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search actions — jump to a saved search, switch mode, run an export, or open Settings, Help,
            Collections, or Wishlists.
          </Dialog.Description>
          <div className="flex items-center gap-2 border-b border-sand-300 px-3 py-2.5 dark:border-husk-50">
            <Search size={15} className="shrink-0 text-coconut-400 dark:text-sand-300" aria-hidden />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={
                filtered[activeIndex] ? `command-palette-option-${activeIndex}` : undefined
              }
              aria-label="Search commands"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Jump to a search, switch mode, export, or open a panel…"
              className="w-full bg-transparent text-sm text-coconut-700 placeholder:text-coconut-400 focus:outline-none dark:text-sand-50 dark:placeholder:text-sand-400"
            />
            <kbd className="shrink-0 rounded border border-sand-300 bg-sand-200 px-1.5 py-0.5 font-mono text-[10px] text-coconut-500 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-300">
              Esc
            </kbd>
          </div>
          <ul id="command-palette-list" role="listbox" aria-label="Commands" className="flex-1 overflow-y-auto p-1.5">
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-coconut-400 dark:text-sand-300">
                No matching commands.
              </li>
            )}
            {filtered.map(({ command }, index) => {
              const Icon = command.icon
              const showGroup = index === 0 || filtered[index - 1].command.group !== command.group
              return (
                <li key={command.id}>
                  {showGroup && (
                    <div className="px-2.5 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wider text-coconut-400 first:pt-1 dark:text-sand-300">
                      {command.group}
                    </div>
                  )}
                  <button
                    type="button"
                    id={`command-palette-option-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    disabled={command.disabled}
                    onClick={() => invoke(command)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      index === activeIndex
                        ? 'bg-sand-200 text-coconut-700 dark:bg-husk-100 dark:text-sand-50'
                        : 'text-coconut-600 dark:text-sand-200'
                    }`}
                  >
                    <Icon size={15} className="shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{command.label}</span>
                    {busyId === command.id ? (
                      <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden />
                    ) : (
                      command.hint && (
                        <span className="shrink-0 text-xs text-coconut-400 dark:text-sand-300">
                          {command.hint}
                        </span>
                      )
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {asyncError && (
            <p className="border-t border-sand-300 px-3 py-2 text-xs text-ember-500 dark:border-husk-50 dark:text-ember-300">
              {asyncError}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
