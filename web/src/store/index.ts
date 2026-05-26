import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProcessingLine, RecentRun, Row, Settings } from '../types'

/** Cap on `recentRuns` so persisted localStorage stays small. */
export const RECENT_RUNS_LIMIT = 10

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  maxPrice: null,
  noImages: true,
  tag: '',
  dedupe: false,
  sort: 'number',
  showTimer: false,
}

interface AppState {
  /** The raw multi-line card-list text typed by the user. */
  inputText: string
  setInputText: (text: string) => void

  /** Accumulated lookup results from the most recent bulk run. */
  rows: Row[]
  setRows: (rows: Row[]) => void
  appendRow: (row: Row) => void
  clearRows: () => void

  /** Progress of the current bulk lookup (0–total). */
  progress: { done: number; total: number } | null
  setProgress: (p: { done: number; total: number } | null) => void

  /** Whether a bulk lookup is in flight. */
  isRunning: boolean
  setIsRunning: (v: boolean) => void

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

  /** Per-input-line status tracked across the current bulk lookup. */
  processingLines: ProcessingLine[]
  setProcessingLines: (lines: ProcessingLine[]) => void
  markLineStatus: (index: number, status: ProcessingLine['status']) => void

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
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      inputText: '',
      setInputText: (text) => set({ inputText: text }),

      rows: [],
      setRows: (rows) => set({ rows }),
      appendRow: (row) => set((state) => ({ rows: [...state.rows, row] })),
      clearRows: () => set({ rows: [] }),

      progress: null,
      setProgress: (progress) => set({ progress }),

      isRunning: false,
      setIsRunning: (isRunning) => set({ isRunning }),

      runStartedAt: null,
      runEndedAt: null,
      setRunStartedAt: (runStartedAt) => set({ runStartedAt }),
      setRunEndedAt: (runEndedAt) => set({ runEndedAt }),

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
    }),
    {
      name: 'mgz-pkmn-settings',
      // Only persist settings + inputText; results are ephemeral.
      partialize: (state) => ({
        inputText: state.inputText,
        settings: state.settings,
        selectedSetIds: state.selectedSetIds,
        recentRuns: state.recentRuns,
      }),
      // Merge persisted state with defaults so new settings fields (e.g.
      // `sort`, added later) fall back to the initial value rather than
      // landing as `undefined` for users with older localStorage entries.
      merge: (persisted, current) => {
        const p = (persisted as Partial<AppState>) ?? {}
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
        }
      },
    },
  ),
)
