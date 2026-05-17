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
import { render, fireEvent, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { ErrorBoundary } from './ErrorBoundary'
import { ExportBar } from './ExportBar'
import { HelpModal } from './HelpModal'
import { InputEditor } from './InputEditor'
import { ProcessingQueue } from './ProcessingQueue'
import { ResultsTable } from './ResultsTable'
import { SettingsDrawer } from './SettingsDrawer'

vi.mock('../api/client', () => ({
  exportFile: vi.fn(),
  downloadSetCardsPdf: vi.fn(),
  parseLine: vi.fn(),
  addOverride: vi.fn(),
}))

const { storeState, storeApi } = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    inputText: '',
    isRunning: false,
    progress: null as { done: number; total: number } | null,
    processingLines: [] as { line: string; status: 'pending' | 'resolved' | 'error' }[],
    settings: {
      apiKey: '',
      maxPrice: null as number | null,
      noImages: true,
      tag: '',
      dedupe: false,
      sort: 'number' as const,
    },
  }
  const api = {
    setInputText: vi.fn((v: string) => {
      state.inputText = v
    }),
    clearRows: vi.fn(() => {
      state.rows = []
    }),
    setProcessingLines: vi.fn(),
    setProgress: vi.fn(),
    setIsRunning: vi.fn(),
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
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
})

describe('a11y: ErrorBoundary (error state)', () => {
  it('rendered fallback has no violations', async () => {
    // Suppress React's expected "caught error" stderr noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Boom(): ReactElement {
      throw new Error('boom')
    }
    await expectNoViolations(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    spy.mockRestore()
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
    fireEvent.click(screen.getByRole('button', { name: /help/i }))
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
