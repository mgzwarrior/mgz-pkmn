import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProcessingLine, Row, Settings } from '../types'

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  maxPrice: null,
  noImages: true,
  tag: '',
  dedupe: false,
  sort: 'number',
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

  /** Per-input-line status tracked across the current bulk lookup. */
  processingLines: ProcessingLine[]
  setProcessingLines: (lines: ProcessingLine[]) => void
  markLineStatus: (index: number, status: ProcessingLine['status']) => void

  /** Persistent settings (survives page reload). */
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => void
  resetSettings: () => void

  /**
   * Set ids selected in the Set ID cards picker modal. Persisted so a
   * reload preserves the user's last selection. Empty array = "every set"
   * (matches the backend's omit-the-filter default).
   */
  selectedSetIds: string[]
  setSelectedSetIds: (ids: string[]) => void
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

      processingLines: [],
      setProcessingLines: (processingLines) => set({ processingLines }),
      markLineStatus: (index, status) =>
        set((state) => {
          const current = state.processingLines[index]
          if (!current || current.status !== 'pending') return state
          const next = state.processingLines.slice()
          next[index] = { ...current, status }
          return { processingLines: next }
        }),

      settings: { ...DEFAULT_SETTINGS },
      updateSettings: (partial) =>
        set((state) => ({ settings: { ...state.settings, ...partial } })),
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),

      selectedSetIds: [],
      setSelectedSetIds: (ids) => set({ selectedSetIds: ids }),
    }),
    {
      name: 'mgz-pkmn-settings',
      // Only persist settings + inputText; results are ephemeral.
      partialize: (state) => ({
        inputText: state.inputText,
        settings: state.settings,
        selectedSetIds: state.selectedSetIds,
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
