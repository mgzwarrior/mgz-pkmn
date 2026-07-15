import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRun } from '../api/client'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import type { RunDetail, RunSummary } from '../types'
import { loadSavedRun } from './loadSavedRun'

vi.mock('../api/client', () => ({
  getRun: vi.fn(),
}))

function makeRun(): RunSummary {
  return {
    id: 42,
    created_at: '2026-06-01T12:00:00Z',
    elapsed_seconds: 1.2,
    row_count: 1,
    summary: {
      total_rows: 1,
      matched: 1,
      missed: 0,
      priced: 1,
      totals_by_currency: { USD: 100 },
      tag_counts: {},
    },
    name: 'Show prep',
    view_state: null,
  }
}

function makeDetail(condition: 'NM' | 'LP' | 'MP' | 'HP' | null): RunDetail {
  return {
    id: 42,
    created_at: '2026-06-01T12:00:00Z',
    elapsed_seconds: 1.2,
    input_text: 'Charizard',
    summary: makeRun().summary,
    rows: [
      {
        position: 0,
        tag: '',
        market_price: 100,
        currency: 'USD',
        query: {
          raw: 'Charizard',
          name: 'Charizard',
          set_hint: null,
          number: null,
          variant_hint: null,
          url_hint: null,
          bulk_top: null,
          bulk_all: false,
          price_min: null,
          price_max: null,
        },
        card: { id: 'base1-4', name: 'Charizard' },
        pricing: {
          market: 100,
          variant: null,
          source: 'TCGPlayer',
          url: null,
          currency: 'USD',
          condition,
        },
      },
    ],
    name: 'Show prep',
    view_state: null,
  }
}

beforeEach(() => {
  vi.mocked(getRun).mockReset()
  useAppStore.setState({
    inputText: '',
    rows: [],
    rowConditionOverrides: {},
    currentRunId: null,
    viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
  })
})

describe('loadSavedRun', () => {
  it('rehydrates persisted row condition pricing into row overrides', async () => {
    vi.mocked(getRun).mockResolvedValue(makeDetail('HP'))

    await loadSavedRun(makeRun(), () => {})

    expect(useAppStore.getState().rowConditionOverrides).toEqual({
      'card:base1-4': 'HP',
    })
  })

  it('replaces stale row condition overrides when the saved rows have none', async () => {
    useAppStore.setState({ rowConditionOverrides: { stale: 'LP' } })
    vi.mocked(getRun).mockResolvedValue(makeDetail(null))

    await loadSavedRun(makeRun(), () => {})

    expect(useAppStore.getState().rowConditionOverrides).toEqual({})
  })
})
