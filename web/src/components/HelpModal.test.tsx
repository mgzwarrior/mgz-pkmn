import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HelpModal } from './HelpModal'
import { renderInlineMarkdown } from '../utils/inlineMarkdown'
import { useAppStore } from '../store'
import { fetchChangelog } from '../api/client'
import type { ChangelogRelease } from '../types'

vi.mock('../api/client', () => ({
  fetchChangelog: vi.fn(),
}))

const mockFetchChangelog = vi.mocked(fetchChangelog)

const RELEASES: ChangelogRelease[] = [
  {
    version: '1.1.1',
    date: '2026-05-25',
    sections: [
      {
        name: 'Added',
        entries: [
          'eBay sold-listings pricing source.',
          'Want-list sharing via the [PyPI tab](https://pypi.org/project/mgz-pkmn/).',
          'Set-walk progress tracker.',
          'A fourth feature that should be capped out of the bar.',
        ],
      },
      { name: 'Fixed', entries: ['README logo renders on the PyPI page.'] },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-05-25',
    sections: [
      { name: 'Added', entries: ['`pkmn cache clear` subcommand.'] },
      { name: 'Changed', entries: ['Export controls render as one dropdown.'] },
    ],
  },
]

describe('renderInlineMarkdown', () => {
  it('renders plain text unchanged', () => {
    const nodes = renderInlineMarkdown('just text')
    render(<span>{nodes}</span>)
    expect(screen.getByText('just text')).toBeInTheDocument()
  })

  it('renders a markdown link as an anchor with the href', () => {
    const nodes = renderInlineMarkdown('see [the docs](https://example.com) now')
    render(<span>{nodes}</span>)
    const link = screen.getByRole('link', { name: 'the docs' })
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('renders a code span as a <code> element', () => {
    const { container } = render(<span>{renderInlineMarkdown('run `pkmn lookup` now')}</span>)
    const code = container.querySelector('code')
    expect(code).not.toBeNull()
    expect(code?.textContent).toBe('pkmn lookup')
  })

  it('renders bold as a <strong> element', () => {
    const { container } = render(
      <span>{renderInlineMarkdown('the **Browse** button')}</span>,
    )
    const strong = container.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong?.textContent).toBe('Browse')
  })

  it('does not emit raw HTML from the bullet text', () => {
    const { container } = render(
      <span>{renderInlineMarkdown('<script>alert(1)</script>')}</span>,
    )
    // The angle brackets are rendered as text, not a real script element.
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })
})

describe('HelpModal', () => {
  beforeEach(() => {
    // The Help-modal trigger reads localStorage to suppress the first-visit
    // hint; clear it so each test starts from the same baseline.
    try {
      window.localStorage.removeItem('mgz-pkmn:seen-help')
    } catch {
      // ignore
    }
    useAppStore.setState({ lastSeenChangelogVersion: null })
    mockFetchChangelog.mockReset()
    mockFetchChangelog.mockResolvedValue(RELEASES)
  })

  it('renders the Help trigger button', async () => {
    render(<HelpModal onStartTour={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /^help$/i })).toBeInTheDocument()
  })

  it('first-time visitor (null lastSeen) gets no dot and is caught up silently', async () => {
    render(<HelpModal onStartTour={vi.fn()} />)
    await waitFor(() =>
      expect(useAppStore.getState().lastSeenChangelogVersion).toBe('1.1.1'),
    )
    // No "new release available" affordance on the button.
    expect(
      screen.queryByRole('button', { name: /new release available/i }),
    ).toBeNull()
  })

  it('shows the unseen dot when a newer release shipped since last seen', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.0' })
    render(<HelpModal onStartTour={vi.fn()} />)
    expect(
      await screen.findByRole('button', { name: /help \(new release available\)/i }),
    ).toBeInTheDocument()
  })

  it('does not show the dot when last seen equals the latest', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.1' })
    render(<HelpModal onStartTour={vi.fn()} />)
    await waitFor(() => expect(mockFetchChangelog).toHaveBeenCalled())
    expect(
      screen.queryByRole('button', { name: /new release available/i }),
    ).toBeNull()
  })

  it('opening the modal alone does not mark the version seen (the dot persists)', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.0' })
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /help \(new release available\)/i }))
    // The bar is collapsed by default; the modal opening must not clear the dot.
    await waitFor(() => expect(mockFetchChangelog).toHaveBeenCalled())
    expect(useAppStore.getState().lastSeenChangelogVersion).toBe('1.1.0')
  })

  it('expanding the What\'s new bar marks the latest version seen', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.0' })
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /help \(new release available\)/i }))
    fireEvent.click(await screen.findByRole('button', { name: /what's new \(new version available\)/i }))
    await waitFor(() =>
      expect(useAppStore.getState().lastSeenChangelogVersion).toBe('1.1.1'),
    )
  })

  it('marks the version seen when the changelog resolves after the bar is already open', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.0' })
    let resolveFetch: (releases: ChangelogRelease[]) => void = () => {}
    mockFetchChangelog.mockReturnValue(
      new Promise<ChangelogRelease[]>((res) => {
        resolveFetch = res
      }),
    )
    render(<HelpModal onStartTour={vi.fn()} />)
    // Open the modal and expand the bar before the changelog arrives.
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    fireEvent.click(screen.getByRole('button', { name: /what's new/i }))
    // Latest is still unknown, so nothing is persisted yet.
    expect(useAppStore.getState().lastSeenChangelogVersion).toBe('1.1.0')
    // The changelog resolves while the panel is open — the late `latest` should
    // still mark the release seen without a collapse/re-expand.
    resolveFetch(RELEASES)
    await waitFor(() =>
      expect(useAppStore.getState().lastSeenChangelogVersion).toBe('1.1.1'),
    )
  })

  it('renders only the latest release\'s top 3 features in the What\'s new bar', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.1' })
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    // Collapsed by default: latest version shown, but features hidden.
    expect(await screen.findByText('v1.1.1')).toBeInTheDocument()
    expect(screen.queryByText(/eBay sold-listings/)).toBeNull()
    // Expand the bar.
    fireEvent.click(screen.getByRole('button', { name: /what's new/i }))
    expect(await screen.findByText(/eBay sold-listings/)).toBeInTheDocument()
    expect(screen.getByText(/Set-walk progress tracker/)).toBeInTheDocument()
    // Fourth Added entry is capped out, and older releases aren't listed.
    expect(screen.queryByText(/capped out of the bar/)).toBeNull()
    expect(screen.queryByText('v1.1.0')).toBeNull()
    // Inline markdown link inside a feature rendered as an anchor.
    expect(screen.getByRole('link', { name: 'PyPI tab' })).toBeInTheDocument()
  })

  it('shows a What\'s new fallback when the changelog fetch fails', async () => {
    mockFetchChangelog.mockRejectedValue(new Error('boom'))
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /what's new/i }))
    expect(await screen.findByText(/couldn't be loaded/i)).toBeInTheDocument()
  })

  it('documents the current app surfaces (modes, results, library)', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.1' })
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    // Discovery modes, results/detail surface, and the Library tabs each
    // have a matching help section.
    expect(await screen.findByText('Finding cards')).toBeInTheDocument()
    expect(screen.getByText('Results & card details')).toBeInTheDocument()
    expect(screen.getByText('Backpack')).toBeInTheDocument()
    expect(screen.getByText('Binders')).toBeInTheDocument()
  })

  it('leads with Swipe and Browse, with Search third', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.1' })
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    // The three modes render as titled tiles in newcomer-first order.
    const finding = (await screen.findByText('Finding cards')).closest('section')!
    const names = Array.from(finding.querySelectorAll('span.font-semibold')).map(
      (el) => el.textContent,
    )
    expect(names).toEqual(['Swipe', 'Browse', 'Search'])
    // Swipe/Browse carry their newcomer badges; Search does not.
    expect(screen.getByText('Easiest')).toBeInTheDocument()
    expect(screen.getByText('Most popular')).toBeInTheDocument()
  })

  it('reflects the current browse, save, and settings surfaces', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.1' })
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    // Browse covers the By Pokédex # view and the card-category filter (#577 / #700).
    expect(await screen.findByText(/By Pokédex #/)).toBeInTheDocument()
    // Saving is the one-tap Want / Own quick-action pair (ADR-0027).
    expect(screen.getByText('Saving cards')).toBeInTheDocument()
    expect(screen.getByText('Want')).toBeInTheDocument()
    expect(screen.getByText('Own')).toBeInTheDocument()
    // Settings surface the toggles shipped since the last edit.
    expect(screen.getByText('Show eBay comps')).toBeInTheDocument()
    expect(screen.getByText('Hide owned cards')).toBeInTheDocument()
    expect(screen.getByText('Show lookup timer')).toBeInTheDocument()
  })

  it('Take the tour button closes the modal and fires the callback', async () => {
    const onStartTour = vi.fn()
    render(<HelpModal onStartTour={onStartTour} />)
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /take the tour/i }))
    expect(onStartTour).toHaveBeenCalledOnce()
  })
})
