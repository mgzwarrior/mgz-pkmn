import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnnouncementBanner } from './AnnouncementBanner'

const DISMISS_KEY = 'mgz-pkmn-announce-survey-v1'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('AnnouncementBanner', () => {
  it('renders the survey CTA when localStorage has no dismiss flag', () => {
    render(<AnnouncementBanner />)
    expect(screen.getByRole('region', { name: 'Site announcement' })).toBeTruthy()
    const cta = screen.getByRole('link', { name: /take the 2-min survey/i })
    expect(cta.getAttribute('href')).toMatch(/^https:\/\/tally\.so\//)
    expect(cta.getAttribute('target')).toBe('_blank')
  })

  it('does not render when localStorage already carries the dismiss flag', () => {
    localStorage.setItem(DISMISS_KEY, '1')
    const { container } = render(<AnnouncementBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('hides itself and persists the choice when the dismiss button is clicked', () => {
    render(<AnnouncementBanner />)
    const dismiss = screen.getByRole('button', { name: 'Dismiss announcement' })
    fireEvent.click(dismiss)
    expect(screen.queryByRole('region', { name: 'Site announcement' })).toBeNull()
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1')
  })

  it('stays hidden across re-renders once localStorage is set', () => {
    const { unmount } = render(<AnnouncementBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }))
    unmount()

    const { container } = render(<AnnouncementBanner />)
    expect(container.firstChild).toBeNull()
  })
})
