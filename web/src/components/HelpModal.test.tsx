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
        name: 'Fixed',
        entries: ['README logo renders on the [PyPI tab](https://pypi.org/project/mgz-pkmn/).'],
      },
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

  it('opening the modal marks the latest version seen, clearing the dot', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.0' })
    render(<HelpModal onStartTour={vi.fn()} />)
    const btn = await screen.findByRole('button', { name: /help \(new release available\)/i })
    fireEvent.click(btn)
    await waitFor(() =>
      expect(useAppStore.getState().lastSeenChangelogVersion).toBe('1.1.1'),
    )
  })

  it('renders release versions, dates, sections, and bullets in the What\'s new section', async () => {
    useAppStore.setState({ lastSeenChangelogVersion: '1.1.1' })
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    expect(await screen.findByText('v1.1.1')).toBeInTheDocument()
    expect(screen.getByText('v1.1.0')).toBeInTheDocument()
    expect(screen.getByText('Fixed')).toBeInTheDocument()
    expect(screen.getByText('Added')).toBeInTheDocument()
    expect(screen.getByText('Changed')).toBeInTheDocument()
    // Inline markdown link inside a bullet rendered as an anchor.
    expect(screen.getByRole('link', { name: 'PyPI tab' })).toBeInTheDocument()
  })

  it('shows a What\'s new fallback when the changelog fetch fails', async () => {
    mockFetchChangelog.mockRejectedValue(new Error('boom'))
    render(<HelpModal onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    expect(await screen.findByText(/couldn't be loaded/i)).toBeInTheDocument()
  })

  it('Take the tour button closes the modal and fires the callback', async () => {
    const onStartTour = vi.fn()
    render(<HelpModal onStartTour={onStartTour} />)
    fireEvent.click(await screen.findByRole('button', { name: /^help$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /take the tour/i }))
    expect(onStartTour).toHaveBeenCalledOnce()
  })
})
