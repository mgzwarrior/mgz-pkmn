import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowseSelectionBar } from './BrowseSelectionBar'
import * as client from '../api/client'
import * as ownershipHook from './useCardOwnership'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import type { CardData } from '../types'
import type { CardOwnership } from '../api/client'

const CHARIZARD: CardData = { id: 'base1-4', name: 'Charizard', number: '4', set: { id: 'base1' } }
const BLASTOISE: CardData = { id: 'base1-2', name: 'Blastoise', number: '2', set: { id: 'base1' } }

const EMPTY: CardOwnership = { collections: [], wishlists: [] }
const OWNED: CardOwnership = {
  collections: [{ id: 1, name: 'Binder', quantity: 1, purpose: 'personal' }],
  wishlists: [],
}

describe('BrowseSelectionBar (#913)', () => {
  const onClear = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    onClear.mockReset()
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
    vi.spyOn(ownershipHook, 'invalidateOwnership').mockImplementation(() => {})
    vi.spyOn(client, 'ownCard').mockResolvedValue({} as never)
    vi.spyOn(client, 'unownCard').mockResolvedValue({} as never)
    vi.spyOn(client, 'wantCard').mockResolvedValue({} as never)
    vi.spyOn(client, 'unwantCard').mockResolvedValue({} as never)
    vi.spyOn(client, 'fetchCollections').mockResolvedValue([])
    vi.spyOn(client, 'fetchWishlists').mockResolvedValue([])
  })

  it('prompts to select when nothing is selected yet, with no action buttons', () => {
    render(
      <BrowseSelectionBar selected={[]} lookupOwnership={() => undefined} onClear={onClear} />,
    )
    expect(screen.getByText('Tap cards to select')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /own selected/i })).not.toBeInTheDocument()
  })

  it('bulk-owns every selected card and busts the ownership cache', async () => {
    render(
      <BrowseSelectionBar
        selected={[CHARIZARD, BLASTOISE]}
        lookupOwnership={() => EMPTY}
        onClear={onClear}
      />,
    )
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /own selected cards/i }))
    await waitFor(() => expect(client.ownCard).toHaveBeenCalledTimes(2))
    expect(client.ownCard).toHaveBeenCalledWith(CHARIZARD)
    expect(client.ownCard).toHaveBeenCalledWith(BLASTOISE)
    expect(ownershipHook.invalidateOwnership).toHaveBeenCalled()
    await waitFor(() => expect(client.fetchCollections).toHaveBeenCalled())
    expect(onClear).toHaveBeenCalled()
  })

  it('bulk-wants every selected card', async () => {
    render(
      <BrowseSelectionBar
        selected={[CHARIZARD]}
        lookupOwnership={() => EMPTY}
        onClear={onClear}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /want selected cards/i }))
    await waitFor(() => expect(client.wantCard).toHaveBeenCalledWith(CHARIZARD))
    await waitFor(() => expect(client.fetchWishlists).toHaveBeenCalled())
  })

  it('undoes a bulk own by unowning only the cards it actually added', async () => {
    // Charizard was already owned before the bulk action; Blastoise was not.
    // Own only writes the not-yet-owned cards, so the write set and the undo
    // set can never drift apart — Charizard is skipped entirely rather than
    // idempotently rewritten, and undo only has Blastoise to reverse.
    const lookupOwnership = (setId: string, number: string) =>
      setId === 'base1' && number === '4' ? OWNED : EMPTY

    render(
      <BrowseSelectionBar
        selected={[CHARIZARD, BLASTOISE]}
        lookupOwnership={lookupOwnership}
        onClear={onClear}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /own selected cards/i }))
    await waitFor(() => expect(client.ownCard).toHaveBeenCalledTimes(1))
    expect(client.ownCard).toHaveBeenCalledWith(BLASTOISE)

    fireEvent.click(await screen.findByRole('button', { name: /undo/i }))
    await waitFor(() => expect(client.unownCard).toHaveBeenCalledTimes(1))
    expect(client.unownCard).toHaveBeenCalledWith(BLASTOISE)
  })

  it('disables Own/Want while any selected card’s ownership is still loading (#767)', () => {
    // `undefined` = the batched ownership lookup hasn't resolved for that
    // card yet. Acting now risks writing a card that's already owned/wanted
    // and then having undo strip that pre-existing state, so both buttons
    // stay disabled until every selected card's ownership is known.
    render(
      <BrowseSelectionBar
        selected={[CHARIZARD, BLASTOISE]}
        lookupOwnership={(setId, number) =>
          setId === 'base1' && number === '4' ? EMPTY : undefined
        }
        onClear={onClear}
      />,
    )
    expect(screen.getByRole('button', { name: /own selected cards/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /want selected cards/i })).toBeDisabled()
  })

  it('surfaces a write failure without clearing the selection', async () => {
    vi.spyOn(client, 'ownCard').mockRejectedValue(new Error('network down'))
    render(
      <BrowseSelectionBar
        selected={[CHARIZARD]}
        lookupOwnership={() => EMPTY}
        onClear={onClear}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /own selected cards/i }))
    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument())
    expect(onClear).not.toHaveBeenCalled()
  })
})
