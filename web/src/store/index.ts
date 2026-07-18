import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_EXPORT_FIELDS } from '../data/exportFields'
import type {
  CacheStatus,
  CardCondition,
  CompTier,
  ProcessingLine,
  RecentRun,
  Row,
  RunSummary,
  SavedViewState,
  Settings,
} from '../types'
import {
  DEFAULT_CONDITION,
  DEFAULT_CONDITION_MULTIPLIERS,
} from '../utils/conditionPricing'

/** Default comp-tier ladder (#542) — matches the pre-#542 hardcoded columns. */
export const DEFAULT_COMP_TIERS: CompTier[] = [
  { percent: 80, visible: true },
  { percent: 85, visible: true },
  { percent: 90, visible: true },
  { percent: 95, visible: true },
]

/** Default ResultsTable view: no sort, no filters, filter row collapsed. */
export const EMPTY_VIEW_STATE: SavedViewState = {
  sortColumn: null,
  sortDir: null,
  showFilters: false,
  filters: {
    name: '',
    set: '',
    rarity: '',
    marketMin: '',
    marketMax: '',
    source: '',
  },
  compTiers: DEFAULT_COMP_TIERS,
}

/** Deep-clone a view state so callers never share mutable filter/tier
 *  objects with `EMPTY_VIEW_STATE` or with each other (mirrors the
 *  `{ ...filters }` spread this replaces). */
export function cloneViewState(viewState: SavedViewState): SavedViewState {
  return {
    ...viewState,
    filters: { ...viewState.filters },
    compTiers: viewState.compTiers.map((tier) => ({ ...tier })),
  }
}

/** Saved runs persisted before #542 have no `compTiers` in their stored
 *  `view_state`; fall back to the default ladder rather than rendering
 *  zero comp columns. */
export function normalizeViewState(viewState: SavedViewState | null): SavedViewState {
  if (!viewState) return cloneViewState(EMPTY_VIEW_STATE)
  return cloneViewState({
    ...viewState,
    compTiers: viewState.compTiers ?? DEFAULT_COMP_TIERS,
  })
}

/** Cap on `recentRuns` so persisted localStorage stays small. */
export const RECENT_RUNS_LIMIT = 10

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  maxPrice: null,
  // Images on by default (#764) — card thumbnails are part of confirming
  // you found the right card, not an opt-in extra. The `merge` below
  // backfills this for users with older persisted settings who never
  // touched the toggle, so their view doesn't change out from under them
  // (it only affects a fresh install / cleared localStorage).
  noImages: false,
  tag: '',
  dedupe: false,
  sort: 'number',
  showTimer: false,
  // Off by default: the eBay source isn't wired into the lookup pipeline
  // yet (epic #416), so the column would be empty for now. The `merge`
  // below backfills this for users with persisted pre-#425 settings.
  showEbay: false,
  // Owned-card filtering is opt-in (#339): a fresh result set shows everything,
  // and the user turns this on to drop cards already in one of their
  // collections, leaving just what's still missing. The `merge` below backfills
  // it for users with older persisted settings.
  hideOwned: false,
  // A clean, price-free view is opt-in (#764) — kids/parents especially want
  // it, but pricing stays the norm elsewhere. The `merge` below backfills
  // this for users with older persisted settings.
  hidePricing: false,
  // Swipe mode opens on the chase tier — only each set's top rarity — so a
  // session feels like flipping chase cards, not walking bulk (#580). The
  // `merge` below backfills this for users with older persisted settings.
  swipeRarityFloor: 'chase',
  // Library-aware exclusion is opt-in (#581): a fresh deck shows everything
  // (minus already-seen), and the user turns these on to hide cards they
  // already own / are already chasing. The `merge` below backfills both for
  // users with older persisted settings.
  swipeExcludeOwned: false,
  swipeExcludeChasing: false,
  // Comfortable keeps today's friendly rhythm; compact (#526) is the
  // vendor-inventorying mode. The `merge` below backfills this for users
  // with older persisted settings.
  density: 'comfortable',
  // Condition-aware pricing (#270): market stays the raw near-mint value,
  // while the UI/export layer derives adjusted prices from this tier.
  condition: DEFAULT_CONDITION,
  conditionMultipliers: DEFAULT_CONDITION_MULTIPLIERS,
  // Configurable-export field toggles (#262). The `merge` below backfills
  // this for users with older persisted settings.
  exportFields: DEFAULT_EXPORT_FIELDS,
  // Off by default (#788) — a single-set export doesn't need a divider.
  // The `merge` below backfills this for users with older persisted settings.
  leadWithIdCard: false,
  // Off by default (#598) — PDFs are print artifacts; dark is opt-in. The
  // `merge` below backfills this for users with older persisted settings.
  darkPdfExports: false,
}

interface AppState {
  /** The raw multi-line card-list text typed by the user. */
  inputText: string
  setInputText: (text: string) => void
  /**
   * Append one or more lines to `inputText`, deduplicating against the
   * existing content so the Browse modal's "Add to list" can be clicked
   * twice on the same card without leaving a stray duplicate. The check
   * is exact-string and case-sensitive on trimmed lines — same shape
   * the backend parser sees — so two distinct query shapes for the same
   * card (e.g. with / without set hint) still both land.
   *
   * Returns the count of lines **actually** appended (post-dedupe) so
   * callers can render an accurate "Added N lines" status — clicking
   * "Add to list" on a card already in the editor honestly reports 0,
   * not 1.
   */
  appendInputLines: (lines: string[]) => number

  /** Accumulated lookup results from the most recent bulk run. */
  rows: Row[]
  setRows: (rows: Row[]) => void
  appendRow: (row: Row) => void
  clearRows: () => void

  /**
   * Per-row condition overrides (#270), keyed by card id when matched and
   * raw input line otherwise. Kept out of localStorage; saved searches
   * rehydrate it from each persisted row's pricing JSON, and the explicit
   * editor Clear action resets it through `clearRowConditionOverrides`.
   */
  rowConditionOverrides: Record<string, CardCondition>
  setRowConditionOverrides: (overrides: Record<string, CardCondition>) => void
  setRowConditionOverride: (rowKey: string, condition: CardCondition | null) => void
  clearRowConditionOverrides: () => void

  /** Progress of the current bulk lookup (0–total). */
  progress: { done: number; total: number } | null
  setProgress: (p: { done: number; total: number } | null) => void

  /** Whether a bulk lookup is in flight. */
  isRunning: boolean
  setIsRunning: (v: boolean) => void

  /**
   * Whether [InputEditor](../components/InputEditor.tsx) is collapsed to
   * its one-line "N card lines · Edit" summary (#523). Lives in the store
   * (not local component state) so [loadSavedRun](../components/loadSavedRun.ts)
   * — called from both the Backpack's Searches tab and the results pane's
   * empty state — can re-expand it directly; a saved search can land while
   * the editor is collapsed from a prior run, and the isRunning-transition
   * effect that drives collapse never fires for a load (it doesn't touch
   * isRunning), so nothing else would flip it back.
   */
  editorCollapsed: boolean
  setEditorCollapsed: (v: boolean) => void

  /**
   * Wall-clock timestamps (Date.now()) bracketing the most recent bulk run.
   * `runStartedAt` is set when the first SSE event arrives so the elapsed
   * value reflects user-felt latency (network + SSE overhead included).
   * `runEndedAt` is set when the run finishes — by completion, stop, or
   * error — and stays set so the post-run summary remains visible.
   */
  runStartedAt: number | null
  runEndedAt: number | null
  setRunStartedAt: (t: number | null) => void
  setRunEndedAt: (t: number | null) => void

  /**
   * Disk-cache freshness of the most recent run, from the SSE done frame.
   * `null` while a run is in flight or before any run this session; the
   * lookup-timer reads it to show a cache-vs-upstream source chip (#310).
   */
  cacheStatus: CacheStatus | null
  setCacheStatus: (s: CacheStatus | null) => void

  /** Per-input-line status tracked across the current bulk lookup. */
  processingLines: ProcessingLine[]
  setProcessingLines: (lines: ProcessingLine[]) => void
  markLineStatus: (index: number, status: ProcessingLine['status']) => void
  /**
   * Record the latest pipeline stage for a line. Resets `stageStartedAt`
   * only when the stage actually changes, so the chip tooltip measures
   * time spent in the *current* stage rather than since the run began.
   */
  updateLineStage: (index: number, stage: NonNullable<ProcessingLine['stage']>) => void

  /** Persistent settings (survives page reload). */
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => void
  resetSettings: () => void

  /**
   * Set ids the user last successfully submitted from the picker modal.
   * Persisted so reopening the picker restores the prior selection.
   *
   * An empty array means "nothing has been chosen yet" — the picker
   * disables its Download PDF button in that state. (The backend would
   * happily accept an empty `set_ids` and render every set, but the UI
   * intentionally never sends that request because hitting Set ID
   * cards… and immediately submitting shouldn't dump a 173-page PDF.)
   */
  selectedSetIds: string[]
  setSelectedSetIds: (ids: string[]) => void

  /**
   * History of recently submitted card-list runs. Newest first.
   * Capped at `RECENT_RUNS_LIMIT` so persisted localStorage stays
   * small.
   */
  recentRuns: RecentRun[]
  pushRecentRun: (lines: string[]) => void
  removeRecentRun: (id: string) => void
  clearRecentRuns: () => void

  /**
   * Saved searches from `GET /api/v1/runs` — the endpoint filters to
   * runs the user has explicitly saved (named). Refreshed on sidebar
   * mount, after each completed bulk run, and on demand. Not persisted
   * locally — the API is the source of truth.
   */
  runs: RunSummary[]
  setRuns: (runs: RunSummary[]) => void
  /** Id of the run currently loaded into the editor / results, if any.
   * Set on click-to-load *and* on a fresh `/bulk` completion (the SSE
   * `done` frame surfaces it), so the Save button always knows what to
   * promote into the saved list. */
  currentRunId: number | null
  setCurrentRunId: (id: number | null) => void

  /**
   * Live ResultsTable view state — sort + per-column filters + whether
   * the filter row is open. Lifted into the store so:
   *
   * 1. The Save button (rendered outside ResultsTable) can snapshot the
   *    current view when promoting a run into the saved-search list.
   * 2. Click-to-load on a saved search can restore the saved snapshot
   *    without prop-drilling through App / ResultsTable.
   *
   * Not persisted to localStorage — the live view is ephemeral; only
   * deliberately-saved searches carry view state across sessions.
   */
  viewState: SavedViewState
  setViewState: (state: SavedViewState) => void
  resetViewState: () => void

  /**
   * Latest changelog version the user has seen in the "What's new" panel.
   * `null` until the panel first resolves a version. Persisted so the
   * "unseen release" dot only shows when a newer release has shipped
   * since the user last opened the panel. A first-time visitor (null) is
   * initialised silently to the current latest — no dot, no nag.
   */
  lastSeenChangelogVersion: string | null
  setLastSeenChangelogVersion: (version: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      inputText: '',
      setInputText: (text) => set({ inputText: text }),
      appendInputLines: (lines) => {
        // Compute the fresh-line slice outside `set()` so we can return
        // its count to the caller. We snapshot the current input via
        // zustand's `get` parameter (not a closure-captured reference
        // to the store hook, which would cause a circular type during
        // initial inference), derive `fresh`, then push that exact list
        // via set. Single source of truth, accurate return value.
        const current = get().inputText
        const incoming = lines.map((l) => l.trim()).filter((l) => l.length > 0)
        if (incoming.length === 0) return 0
        const existing = new Set(
          current.split('\n').map((l) => l.trim()).filter(Boolean),
        )
        const fresh = incoming.filter((l) => !existing.has(l))
        if (fresh.length === 0) return 0
        const sep = current.length === 0 || current.endsWith('\n') ? '' : '\n'
        set({ inputText: current + sep + fresh.join('\n') + '\n' })
        return fresh.length
      },

      rows: [],
      setRows: (rows) => set({ rows }),
      appendRow: (row) => set((state) => ({ rows: [...state.rows, row] })),
      clearRows: () => set({ rows: [] }),

      rowConditionOverrides: {},
      setRowConditionOverrides: (rowConditionOverrides) => set({ rowConditionOverrides }),
      setRowConditionOverride: (rowKey, condition) =>
        set((state) => {
          const next = { ...state.rowConditionOverrides }
          if (condition === null) delete next[rowKey]
          else next[rowKey] = condition
          return { rowConditionOverrides: next }
        }),
      clearRowConditionOverrides: () => set({ rowConditionOverrides: {} }),

      progress: null,
      setProgress: (progress) => set({ progress }),

      isRunning: false,
      setIsRunning: (isRunning) => set({ isRunning }),

      editorCollapsed: false,
      setEditorCollapsed: (editorCollapsed) => set({ editorCollapsed }),

      runStartedAt: null,
      runEndedAt: null,
      setRunStartedAt: (runStartedAt) => set({ runStartedAt }),
      setRunEndedAt: (runEndedAt) => set({ runEndedAt }),

      cacheStatus: null,
      setCacheStatus: (cacheStatus) => set({ cacheStatus }),

      processingLines: [],
      setProcessingLines: (processingLines) => set({ processingLines }),
      markLineStatus: (index, status) =>
        set((state) => {
          const current = state.processingLines[index]
          if (!current || current.status !== 'pending') return state
          const next = state.processingLines.slice()
          next[index] = { ...current, status, endedAt: Date.now() }
          return { processingLines: next }
        }),
      updateLineStage: (index, stage) =>
        set((state) => {
          const current = state.processingLines[index]
          if (!current || current.stage === stage) return state
          const next = state.processingLines.slice()
          next[index] = { ...current, stage, stageStartedAt: Date.now() }
          return { processingLines: next }
        }),

      settings: { ...DEFAULT_SETTINGS },
      updateSettings: (partial) =>
        set((state) => ({ settings: { ...state.settings, ...partial } })),
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),

      selectedSetIds: [],
      setSelectedSetIds: (ids) => set({ selectedSetIds: ids }),

      recentRuns: [],
      pushRecentRun: (lines) =>
        set((state) => {
          if (lines.length === 0) return state
          // Collapse consecutive duplicates: if the user just re-runs
          // the same list (or clicks the same chip twice), don't
          // record the same lines back-to-back — bump the existing
          // entry's savedAt instead so the chronological order
          // still makes sense.
          const head = state.recentRuns[0]
          const sameAsHead =
            head && head.lines.length === lines.length &&
            head.lines.every((l, i) => l === lines[i])
          if (sameAsHead) {
            const refreshed: RecentRun = { ...head, savedAt: Date.now() }
            return { recentRuns: [refreshed, ...state.recentRuns.slice(1)] }
          }
          const next: RecentRun = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            savedAt: Date.now(),
            lines,
          }
          return {
            recentRuns: [next, ...state.recentRuns].slice(0, RECENT_RUNS_LIMIT),
          }
        }),
      removeRecentRun: (id) =>
        set((state) => ({
          recentRuns: state.recentRuns.filter((r) => r.id !== id),
        })),
      clearRecentRuns: () => set({ recentRuns: [] }),

      runs: [],
      setRuns: (runs) => set({ runs }),
      currentRunId: null,
      setCurrentRunId: (currentRunId) => set({ currentRunId }),

      viewState: cloneViewState(EMPTY_VIEW_STATE),
      setViewState: (viewState) => set({ viewState }),
      resetViewState: () => set({ viewState: cloneViewState(EMPTY_VIEW_STATE) }),

      lastSeenChangelogVersion: null,
      setLastSeenChangelogVersion: (version) =>
        set({ lastSeenChangelogVersion: version }),
    }),
    {
      name: 'mgz-pkmn-settings',
      // Only persist settings + inputText; results are ephemeral.
      partialize: (state) => ({
        inputText: state.inputText,
        settings: state.settings,
        selectedSetIds: state.selectedSetIds,
        recentRuns: state.recentRuns,
        lastSeenChangelogVersion: state.lastSeenChangelogVersion,
      }),
      // Merge persisted state with defaults so new settings fields (e.g.
      // `sort`, added later) fall back to the initial value rather than
      // landing as `undefined` for users with older localStorage entries.
      merge: (persisted, current) => {
        const p = (persisted as Partial<AppState>) ?? {}
        return {
          ...current,
          ...p,
          settings: mergeSettings(current.settings, p.settings),
          rowConditionOverrides: {},
        }
      },
    },
  ),
)

function mergeSettings(current: Settings, persisted?: Partial<Settings>): Settings {
  const p = persisted ?? {}
  return {
    ...current,
    ...p,
    conditionMultipliers: {
      ...(current.conditionMultipliers ?? DEFAULT_CONDITION_MULTIPLIERS),
      ...(p.conditionMultipliers ?? {}),
    },
    exportFields: {
      xlsx: { ...current.exportFields.xlsx, ...(p.exportFields?.xlsx ?? {}) },
      pdf: { ...current.exportFields.pdf, ...(p.exportFields?.pdf ?? {}) },
      'condensed-pdf': {
        ...current.exportFields['condensed-pdf'],
        ...(p.exportFields?.['condensed-pdf'] ?? {}),
      },
      checklist: {
        ...current.exportFields.checklist,
        ...(p.exportFields?.checklist ?? {}),
      },
    },
  }
}
