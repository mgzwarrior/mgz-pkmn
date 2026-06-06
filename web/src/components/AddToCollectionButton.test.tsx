import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddToCollectionButton } from './AddToCollectionButton'
import { _resetCollectionsCacheForTests } from './useCollections'
import {
  fetchCollections,
  createCollection,
  addCardToCollection,
} from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  addCardToCollection: vi.fn(),
}))

const mockFetch = vi.mocked(fetchCollections)
const mockCreate = vi.mocked(createCollection)
const mockAdd = vi.mocked(addCardToCollection)

const SAMPLE_CARD = { id: 'base1-4', name: 'Charizard' }

function openMenu() {
  // Radix DropdownMenu opens on pointerdown, not click — use the
  // keyboard activation path which works reliably under jsdom.
  const trigger = screen.getByRole('button', { name: /Save to collection/i })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
}

describe('AddToCollectionButton', () => {
  beforeEach(() => {
    _resetCollectionsCacheForTests()
    mockFetch.mockReset()
    mockCreate.mockReset()
    mockAdd.mockReset()
  })

  it('renders the trigger and fetches collections on mount', async () => {
    mockFetch.mockResolvedValue([])
    render(<AddToCollectionButton card={SAMPLE_CARD} />)
    expect(
      screen.getByRole('button', { name: /Save to collection/i }),
    ).toBeInTheDocument()
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
  })

  it('shows an empty state when no collections exist', async () => {
    mockFetch.mockResolvedValue([])
    render(<AddToCollectionButton card={SAMPLE_CARD} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    openMenu()
    await waitFor(() =>
      expect(screen.getByText(/No collections yet/i)).toBeInTheDocument(),
    )
  })

  it('lists existing collections and adds the card on click', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 7,
        name: 'Binder candidates',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 0,
      },
    ])
    mockAdd.mockResolvedValue({
      id: 1,
      card: SAMPLE_CARD,
      notes: null,
      added_at: '2026-06-06T00:00:01',
    })

    render(<AddToCollectionButton card={SAMPLE_CARD} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    openMenu()
    const label = await screen.findByText('Binder candidates')
    const item = label.closest('[role="menuitem"]')!
    fireEvent.click(item)

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith(7, SAMPLE_CARD, undefined))
  })

  it('creates a new collection and adds the card in one flow', async () => {
    mockFetch.mockResolvedValue([])
    mockCreate.mockResolvedValue({
      id: 42,
      name: 'Show pickups',
      description: null,
      created_at: '2026-06-06T00:00:00',
      items: [],
    })
    mockAdd.mockResolvedValue({
      id: 1,
      card: SAMPLE_CARD,
      notes: null,
      added_at: '2026-06-06T00:00:01',
    })

    render(<AddToCollectionButton card={SAMPLE_CARD} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    openMenu()

    const newItem = (await screen.findByText(/New collection/i)).closest(
      '[role="menuitem"]',
    )!
    fireEvent.click(newItem)
    const input = await screen.findByRole('textbox', {
      name: /New collection name/i,
    })
    fireEvent.change(input, { target: { value: 'Show pickups' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Show pickups', undefined))
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith(42, SAMPLE_CARD, undefined))
  })

  it('surfaces an error when the add call fails', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 7,
        name: 'Errors here',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 0,
      },
    ])
    mockAdd.mockRejectedValue(new Error('boom'))

    render(<AddToCollectionButton card={SAMPLE_CARD} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    openMenu()
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Errors here/i }),
    )
    await waitFor(() =>
      expect(screen.getByText(/boom/)).toBeInTheDocument(),
    )
  })
})
