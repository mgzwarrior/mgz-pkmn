import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddToListPicker } from './AddToListPicker'
import { useCollections } from './useCollections'
import { useWishlists } from './useWishlists'
import type { CardOwnership } from '../api/client'

vi.mock('./useCollections', () => ({ useCollections: vi.fn() }))
vi.mock('./useWishlists', () => ({ useWishlists: vi.fn() }))

const CARD = { id: 'base1-4', name: 'Charizard', set: { id: 'base1' }, number: '4' }

const addCardC = vi.fn(async () => {})
const addCardW = vi.fn(async () => {})
const createC = vi.fn(async () => ({ id: 99, name: 'New' }))
const createW = vi.fn(async () => ({ id: 88, name: 'New' }))

function setLists(
  collections: { id: number; name: string; item_count: number; kind?: string }[],
  wishlists: { id: number; name: string; item_count: number }[],
) {
  vi.mocked(useCollections).mockReturnValue({
    collections,
    addCard: addCardC,
    create: createC,
  } as unknown as ReturnType<typeof useCollections>)
  vi.mocked(useWishlists).mockReturnValue({
    wishlists,
    addCard: addCardW,
    create: createW,
  } as unknown as ReturnType<typeof useWishlists>)
}

function open() {
  const trigger = screen.getByRole('button', { name: /add to a list/i })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
}

describe('AddToListPicker (#762)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setLists(
      [
        { id: 1, name: 'Show Binder', item_count: 4, kind: 'manual' },
        { id: 2, name: 'Smart set', item_count: 9, kind: 'dynamic' },
      ],
      [{ id: 5, name: 'Chase list', item_count: 2 }],
    )
  })

  it('offers hand-curated collections and want-lists, hiding dynamic ones', () => {
    render(<AddToListPicker card={CARD} ownership={null} />)
    open()
    expect(screen.getByRole('menuitem', { name: /Show Binder/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Chase list/i })).toBeInTheDocument()
    // Dynamic (smart) collections are rule-resolved — not hand-addable.
    expect(screen.queryByRole('menuitem', { name: /Smart set/i })).toBeNull()
  })

  it('excludes lists the card already lives in', () => {
    const ownership: CardOwnership = {
      collections: [{ id: 1, name: 'Show Binder', quantity: 1 }],
      wishlists: [{ id: 5, name: 'Chase list' }],
    }
    render(<AddToListPicker card={CARD} ownership={ownership} />)
    open()
    expect(screen.queryByRole('menuitem', { name: /Show Binder/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Chase list/i })).toBeNull()
  })

  it('withholds existing lists until ownership is known, keeping create available', () => {
    // `undefined` = the batched ownership lookup is still in flight; offering
    // an occupied list now would insert a duplicate row (#762 review).
    render(<AddToListPicker card={CARD} ownership={undefined} />)
    open()
    expect(screen.queryByRole('menuitem', { name: /Show Binder/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Chase list/i })).toBeNull()
    // Create-and-add stays available — a brand-new list can't already hold it.
    expect(screen.getByRole('menuitem', { name: /New collection/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /New want-list/i })).toBeInTheDocument()
  })

  it('adds the card to a chosen collection', async () => {
    render(<AddToListPicker card={CARD} ownership={null} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /Show Binder/i }))
    await waitFor(() => expect(addCardC).toHaveBeenCalledWith(1, CARD))
  })

  it('adds the card to a chosen want-list', async () => {
    render(<AddToListPicker card={CARD} ownership={null} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /Chase list/i }))
    await waitFor(() => expect(addCardW).toHaveBeenCalledWith(5, CARD))
  })

  it('creates a new collection and adds the card to it', async () => {
    render(<AddToListPicker card={CARD} ownership={null} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /New collection/i }))
    fireEvent.change(screen.getByLabelText(/Collection name/i), {
      target: { value: 'Graded slabs' },
    })
    fireEvent.keyDown(screen.getByLabelText(/Collection name/i), { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(createC).toHaveBeenCalledWith('Graded slabs'))
    await waitFor(() => expect(addCardC).toHaveBeenCalledWith(99, CARD))
  })
})
