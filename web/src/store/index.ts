import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Row, Settings } from '../types'

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

  /** Persistent settings (survives page reload). */
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => void
  resetSettings: () => void
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

      settings: { ...DEFAULT_SETTINGS },
      updateSettings: (partial) =>
        set((state) => ({ settings: { ...state.settings, ...partial } })),
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),
    }),
    {
      name: 'mgz-pkmn-settings',
      // Only persist settings + inputText; results are ephemeral.
      partialize: (state) => ({
        inputText: state.inputText,
        settings: state.settings,
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
