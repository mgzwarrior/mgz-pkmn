import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExportBar } from './ExportBar'
import { useAppStore } from '../store'
import type { Row } from '../types'

vi.mock('../api/client', () => ({
  exportFile: vi.fn(),
  downloadSetCardsPdf: vi.fn(),
}))

/**
 * Radix DropdownMenu opens on `pointerdown`, not on `click`, so the plain
 * `fireEvent.click` shorthand doesn't reveal the menu in jsdom. Fire the
 * full sequence keyboard users follow: focus the trigger and press Enter.
 */
function openDropdown() {
  const trigger = screen.getByRole('button', { name: 'Export' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
}

function makeRow(matched: boolean): Row {
  return {
    query: {
      raw: 'Pikachu | Jungle',
      name: 'Pikachu',
      set_hint: 'Jungle',
      number: null,
      variant_hint: null,
      url_hint: null,
      bulk_top: null,
      bulk_all: false,
      price_min: null,
      price_max: null,
    },
    card: matched ? { id: 'jungle-60', name: 'Pikachu' } : null,
    pricing: { market: null, variant: null, source: null, url: null, currency: 'USD' },
    tag: '',
    matched,
    reason: matched ? 'matched' : 'no match',
  }
}

describe('ExportBar', () => {
  beforeEach(() => {
    // Each test starts with the default empty store.
    useAppStore.setState({ rows: [] })
  })

  it('renders an Export trigger', () => {
    render(<ExportBar />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  })

  it('lists every export format when the dropdown opens', () => {
    render(<ExportBar />)
    openDropdown()
    expect(screen.getByText('Download .xlsx')).toBeInTheDocument()
    expect(screen.getByText('PDF binder')).toBeInTheDocument()
    expect(screen.getByText('Condensed PDF')).toBeInTheDocument()
    expect(screen.getByText('Checklist')).toBeInTheDocument()
    expect(screen.getByText('Set ID cards')).toBeInTheDocument()
  })

  it('disables row-dependent items when no rows are matched, but keeps Set ID cards enabled', () => {
    render(<ExportBar />)
    openDropdown()

    for (const label of ['Download .xlsx', 'PDF binder', 'Condensed PDF', 'Checklist']) {
      const item = screen.getByText(label).closest('[role="menuitem"]')!
      expect(item).toHaveAttribute('data-disabled')
    }
    const setCards = screen.getByText('Set ID cards').closest('[role="menuitem"]')!
    expect(setCards).not.toHaveAttribute('data-disabled')

    // Row count label is only shown when there are matched rows.
    expect(screen.queryByText(/^\d+ rows?$/)).not.toBeInTheDocument()
  })

  it('enables row-dependent items and shows the row count when matches exist', () => {
    useAppStore.setState({ rows: [makeRow(true), makeRow(true), makeRow(false)] })

    render(<ExportBar />)
    openDropdown()

    for (const label of ['Download .xlsx', 'PDF binder', 'Condensed PDF', 'Checklist']) {
      const item = screen.getByText(label).closest('[role="menuitem"]')!
      expect(item).not.toHaveAttribute('data-disabled')
    }
    expect(screen.getByText('2 rows')).toBeInTheDocument()
  })

  it('uses singular "row" when exactly one match exists', () => {
    useAppStore.setState({ rows: [makeRow(true)] })

    render(<ExportBar />)
    openDropdown()

    expect(screen.getByText('1 row')).toBeInTheDocument()
  })
})
