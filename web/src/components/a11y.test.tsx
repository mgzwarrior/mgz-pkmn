/**
 * a11y.test — runs axe-core against every top-level component to enforce
 * the "no critical violations" half of #62.
 *
 * Strategy: one `describe` per component, each mounting it with whatever
 * store / props are needed to render the most common visible state. The
 * matcher fails on any axe violation, so this is stricter than the issue
 * requires — the bar is "no critical", but the test guards against
 * regressions of any severity. If a non-critical finding turns out to be
 * a wontfix (e.g. a third-party library quirk), narrow the rule via
 * axe's `rules` config in the relevant test rather than weakening the
 * matcher globally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, fireEvent, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'
import { BrowserRouter } from 'react-router'

import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { ErrorBoundary } from './ErrorBoundary'
import { ExportBar } from './ExportBar'
import { HelpModal } from './HelpModal'
import { InputEditor } from './InputEditor'
import { ProcessingQueue } from './ProcessingQueue'
import { ResultsTable } from './ResultsTable'
import { SettingsDrawer } from './SettingsDrawer'
import { SignInChip } from './SignInChip'
import type { Row } from '../types'

// SignInChip reads the URL through react-router hooks (#864); wrap every
// mount in a BrowserRouter so the shared render stays uniform.
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: BrowserRouter })
}

vi.mock('../api/client', () => ({
  exportFile: vi.fn(),
  downloadSetCardsPdf: vi.fn(),
  parseLine: vi.fn(),
  addOverride: vi.fn(),
  updateRunRowCondition: vi.fn(),
  // SignInChip's useAuth fires `fetchMe` on mount; the anonymous
  // resolution lets the chip settle on the Sign-in button shape under
  // axe, while the signed-in-state scan below overrides it per-test.
  fetchMe: vi.fn().mockResolvedValue({ user: null, authEnabled: true }),
  logout: vi.fn(),
  requestMagicLink: vi.fn(),
  // HelpModal fetches the changelog on mount for its What's new section;
  // an empty list keeps the scan focused on the rest of the modal without
  // pulling release-note copy in.
  fetchChangelog: vi.fn().mockResolvedValue([]),
  // Settings drawer mounts the cache-stats panel on open, which fetches
  // on mount. Return a zeroed snapshot so the a11y scan sees the loaded
  // state instead of the loading spinner.
  fetchCacheStats: vi.fn().mockResolvedValue({
    root: '/tmp/cache',
    api_entry_count: 0,
    api_bytes: 0,
    api_oldest_mtime: null,
    override_count: 0,
    override_bytes: 0,
    image_entry_count: 0,
    image_bytes: 0,
    concept_warm_timestamp: null,
    concept_warm_names: 0,
    set_cards_warm_timestamp: null,
    set_cards_warm_count: 0,
    sets_warm_timestamp: null,
    sets_warm_count: 0,
    card_warm_timestamp: null,
    card_warm_count: 0,
    card_warm_failed_count: 0,
  }),
}))

const { storeState, storeApi } = vi.hoisted(() => {
  const emptyViewState = {
    sortColumn: null as 'name' | 'set' | 'rarity' | 'market' | 'source' | null,
    sortDir: null as 'asc' | 'desc' | null,
    showFilters: false,
    filters: {
      name: '',
      set: '',
      rarity: '',
      marketMin: '',
      marketMax: '',
      source: '',
    },
    compTiers: [
      { percent: 80, visible: true },
      { percent: 85, visible: true },
      { percent: 90, visible: true },
      { percent: 95, visible: true },
    ],
  }
  const state = {
    rows: [] as Row[],
    inputText: '',
    isRunning: false,
    progress: null as { done: number; total: number } | null,
    processingLines: [] as { line: string; status: 'pending' | 'resolved' | 'error' }[],
    rowConditionOverrides: {} as Record<string, 'NM' | 'LP' | 'MP' | 'HP'>,
    settings: {
      apiKey: '',
      maxPrice: null as number | null,
      noImages: true,
      tag: '',
      dedupe: false,
      sort: 'number' as const,
      showTimer: false,
      showEbay: false,
      density: 'comfortable' as 'comfortable' | 'compact',
      condition: 'NM' as const,
      conditionMultipliers: { NM: 1, LP: 0.85, MP: 0.65, HP: 0.45 },
      // Per-format toggle record (#262) — empty sub-objects are fine, the
      // component falls back to "checked" for any field key not present.
      exportFields: { xlsx: {}, pdf: {}, 'condensed-pdf': {}, checklist: {} },
    },
    runs: [] as unknown[],
    currentRunId: null as number | null,
    viewState: { ...emptyViewState, filters: { ...emptyViewState.filters } },
  }
  const api = {
    setInputText: vi.fn((v: string) => {
      state.inputText = v
    }),
    clearRows: vi.fn(() => {
      state.rows = []
    }),
    setProcessingLines: vi.fn(),
    setRowConditionOverrides: vi.fn((v: typeof state.rowConditionOverrides) => {
      state.rowConditionOverrides = v
    }),
    setRowConditionOverride: vi.fn((key: string, condition: 'NM' | 'LP' | 'MP' | 'HP' | null) => {
      if (condition === null) delete state.rowConditionOverrides[key]
      else state.rowConditionOverrides[key] = condition
    }),
    clearRowConditionOverrides: vi.fn(() => {
      state.rowConditionOverrides = {}
    }),
    setProgress: vi.fn(),
    setIsRunning: vi.fn(),
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    setViewState: vi.fn((v: typeof state.viewState) => {
      state.viewState = v
    }),
    resetViewState: vi.fn(() => {
      state.viewState = { ...emptyViewState, filters: { ...emptyViewState.filters } }
    }),
    setRuns: vi.fn(),
    setCurrentRunId: vi.fn(),
  }
  return { storeState: state, storeApi: api }
})

vi.mock('../store', () => {
  function getState() {
    return { ...storeState, ...storeApi }
  }
  const useAppStore = ((selector?: (s: ReturnType<typeof getState>) => unknown) => {
    const s = getState()
    return selector ? selector(s) : s
  }) as unknown as {
    (...args: unknown[]): unknown
    getState: typeof getState
    setState: (patch: Partial<typeof storeState>) => void
  }
  useAppStore.getState = getState
  useAppStore.setState = (patch) => {
    Object.assign(storeState, patch)
  }
  return { useAppStore }
})

async function expectNoViolations(ui: ReactElement) {
  const { container } = render(ui)
  const results = await axe(container)
  expect(results).toHaveNoViolations()
}

beforeEach(() => {
  storeState.rows = []
  storeState.inputText = ''
  storeState.isRunning = false
  storeState.progress = null
  storeState.processingLines = []
  storeState.rowConditionOverrides = {}
  _resetAuthStoreForTests()
})

describe('a11y: ErrorBoundary (error state)', () => {
  it('rendered fallback has no violations', async () => {
    // Suppress React's expected "caught error" stderr noise. try/finally
    // so a regression in the assertion doesn't leave the spy installed —
    // a leaked stub would swallow legitimate console.error output in
    // every subsequent test in the run.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Boom(): ReactElement {
      throw new Error('boom')
    }
    try {
      await expectNoViolations(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
    } finally {
      spy.mockRestore()
    }
  })
})

describe('a11y: ExportBar (no matched rows)', () => {
  it('disabled-state buttons have no violations', async () => {
    await expectNoViolations(<ExportBar />)
  })
})

describe('a11y: HelpModal (trigger closed)', () => {
  it('icon-only trigger has no violations', async () => {
    await expectNoViolations(<HelpModal onStartTour={vi.fn()} />)
  })
})

describe('a11y: InputEditor (empty)', () => {
  it('textarea + run button have no violations', async () => {
    await expectNoViolations(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
  })
})

describe('a11y: ProcessingQueue (mid-run)', () => {
  it('queue list has no violations', async () => {
    storeState.processingLines = [
      { line: 'Charizard | Base Set | 4', status: 'resolved' },
      { line: 'Pikachu | Jungle', status: 'error' },
      { line: 'top:5 Mew ex', status: 'pending' },
    ]
    storeState.isRunning = true
    await expectNoViolations(<ProcessingQueue />)
  })
})

describe('a11y: ResultsTable (empty state)', () => {
  it('empty-state has no violations', async () => {
    await expectNoViolations(<ResultsTable />)
  })
})

// Populated-state coverage — empty-state never mounts the actual <table>,
// so the sr-only labels on empty <th /> header cells, the SortableHeader
// buttons, and the filter-row inputs all go unexercised unless we seed
// rows and expand the filter row. Without this, axe regressions in the
// real table markup would slip past the empty-state coverage above.
describe('a11y: ResultsTable (populated + filters expanded)', () => {
  it('table with rows and visible filter row has no violations', async () => {
    storeState.rows = [
      {
        query: { raw: 'Pikachu | Jungle', name: 'Pikachu' },
        card: {
          id: 'jungle-60',
          name: 'Pikachu',
          number: '60',
          rarity: 'Common',
          set: { id: 'jungle', name: 'Jungle', series: 'Original' },
        },
        pricing: { market: 5.12, currency: 'USD', variant: 'normal', source: 'TCGPlayer', url: null },
        tag: 'demo',
        matched: true,
        reason: '',
      } as Row,
    ]
    const { container } = render(<ResultsTable />)
    fireEvent.click(screen.getByRole('button', { name: /^filter$/i }))
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})

// Compact density (#526) — the same populated table under the app root's
// data-density="compact" attribute, so the `compact:` utilities apply the
// tightened rhythm the scan covers.
describe('a11y: ResultsTable (compact density)', () => {
  it('compact table with rows has no violations', async () => {
    storeState.settings = { ...storeState.settings, density: 'compact' as const }
    storeState.rows = [
      {
        query: { raw: 'Pikachu | Jungle', name: 'Pikachu' },
        card: {
          id: 'jungle-60',
          name: 'Pikachu',
          number: '60',
          rarity: 'Common',
          set: { id: 'jungle', name: 'Jungle', series: 'Original' },
        },
        pricing: { market: 5.12, currency: 'USD', variant: 'normal', source: 'TCGPlayer', url: null },
        tag: 'demo',
        matched: true,
        reason: '',
      } as Row,
    ]
    try {
      await expectNoViolations(
        <div data-density="compact">
          <ResultsTable />
        </div>,
      )
    } finally {
      storeState.settings = { ...storeState.settings, density: 'comfortable' as const }
    }
  })
})

// eBay column coverage — the column + sparkline only mount when the setting
// is on and a row carries eBay data, so seed both to scan the real markup
// (the SVG sparkline carries its own role="img" + aria-label).
describe('a11y: ResultsTable (eBay column enabled)', () => {
  it('eBay column + sparkline have no violations', async () => {
    storeState.settings.showEbay = true
    storeState.rows = [
      {
        query: { raw: 'Charizard | Base Set | 4', name: 'Charizard' },
        card: {
          id: 'base1-4',
          name: 'Charizard',
          number: '4',
          rarity: 'Rare Holo',
          set: { id: 'base1', name: 'Base Set', series: 'Base' },
        },
        pricing: {
          market: 250,
          currency: 'USD',
          variant: 'holofoil',
          source: 'TCGPlayer',
          url: null,
          ebay_sold_median: 230,
          ebay_active_floor: 199.99,
          ebay_sold_comps: [
            { price: 220, date: '2026-01-01', condition: 'Used', url: null },
            { price: 240, date: '2026-02-01', condition: 'Near Mint', url: null },
          ],
        },
        tag: 'demo',
        matched: true,
        reason: '',
      } as Row,
    ]
    try {
      const { container } = render(<ResultsTable />)
      const results = await axe(container)
      expect(results).toHaveNoViolations()
    } finally {
      storeState.settings.showEbay = false
    }
  })
})

describe('a11y: SettingsDrawer (trigger closed)', () => {
  it('icon-only trigger has no violations', async () => {
    await expectNoViolations(<SettingsDrawer />)
  })
})

// Open-modal coverage — Radix portals render to document.body, so we point
// axe at the body to include the dialog content rather than just the mount
// container.
describe('a11y: HelpModal (opened)', () => {
  it('open dialog content has no violations', async () => {
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^help$/i }))
    const results = await axe(document.body)
    expect(results).toHaveNoViolations()
  })
})

describe('a11y: SettingsDrawer (opened)', () => {
  it('open drawer content has no violations', async () => {
    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const results = await axe(document.body)
    expect(results).toHaveNoViolations()
  })
})

describe('a11y: SignInChip (anonymous trigger)', () => {
  it('Sign-in trigger has no violations', async () => {
    const { container } = render(<SignInChip />)
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})

describe('a11y: SignInChip (provider picker opened)', () => {
  it('open picker dialog has no violations', async () => {
    render(<SignInChip />)
    fireEvent.click(await screen.findByRole('button', { name: /sign in/i }))
    // The magic-link form lives behind a second click — expand it so
    // axe scans the input + submit alongside the OAuth anchors.
    fireEvent.click(await screen.findByRole('button', { name: /email me a magic link/i }))
    const results = await axe(document.body)
    expect(results).toHaveNoViolations()
  })
})
