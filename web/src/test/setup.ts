import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Zustand's persist middleware reaches for `localStorage` on every state
// change. jsdom in Node 22 exposes an experimental `localStorage` global
// that throws on `setItem` unless `--localstorage-file` is passed, so we
// install a plain in-memory stub before any test code runs.
const _memory: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => _memory[k] ?? null,
  setItem: (k: string, v: string) => {
    _memory[k] = v
  },
  removeItem: (k: string) => {
    delete _memory[k]
  },
  clear: () => {
    for (const k of Object.keys(_memory)) delete _memory[k]
  },
  key: (i: number) => Object.keys(_memory)[i] ?? null,
  get length() {
    return Object.keys(_memory).length
  },
})

// jsdom doesn't implement matchMedia. Components that subscribe to
// media-query changes (e.g. ExportBar's desktop/mobile switch) call
// `window.matchMedia(...).addEventListener('change', ...)`. Stub it as a
// "no match, no listeners" implementation so those components default to
// the desktop branch in tests.
vi.stubGlobal(
  'matchMedia',
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
)

afterEach(() => {
  cleanup()
})
