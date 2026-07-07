import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CacheSourceChip } from './CacheSourceChip'
import { useAppStore } from '../store'
import { DEFAULT_EXPORT_FIELDS } from '../data/exportFields'

const DEFAULT_SETTINGS = {
  apiKey: '',
  maxPrice: null,
  noImages: true,
  tag: '',
  dedupe: false,
  sort: 'number' as const,
  showTimer: false,
  showEbay: false,
  hideOwned: false,
  hidePricing: false,
  swipeRarityFloor: 'chase' as const,
  swipeExcludeOwned: false,
  swipeExcludeChasing: false,
  density: 'comfortable' as const,
  exportFields: DEFAULT_EXPORT_FIELDS,
  leadWithIdCard: false,
}

describe('CacheSourceChip', () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: true },
      cacheStatus: null,
    })
  })

  it('renders nothing when showTimer is off', () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: false },
      cacheStatus: 'HIT',
    })
    const { container } = render(<CacheSourceChip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing before a run reports a cache status', () => {
    useAppStore.setState({ cacheStatus: null })
    const { container } = render(<CacheSourceChip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows "from cache" on a HIT', () => {
    useAppStore.setState({ cacheStatus: 'HIT' })
    render(<CacheSourceChip />)
    expect(screen.getByText('from cache')).toBeInTheDocument()
  })

  it('flags the background refresh on a STALE read', () => {
    useAppStore.setState({ cacheStatus: 'STALE' })
    render(<CacheSourceChip />)
    expect(screen.getByText('from cache · refreshing')).toBeInTheDocument()
  })

  it('shows "from upstream" on a MISS', () => {
    useAppStore.setState({ cacheStatus: 'MISS' })
    render(<CacheSourceChip />)
    expect(screen.getByText('from upstream')).toBeInTheDocument()
  })

  it('labels the anonymous cache-only miss as not-in-cache, not upstream', () => {
    // cache_only mode skips upstream on a miss, so "from upstream" would be a
    // lie — the card simply wasn't warmed.
    useAppStore.setState({ cacheStatus: 'MISS-CACHE-ONLY' })
    render(<CacheSourceChip />)
    expect(screen.getByText('not in cache')).toBeInTheDocument()
    expect(screen.queryByText('from upstream')).not.toBeInTheDocument()
  })
})
