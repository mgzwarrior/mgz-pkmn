import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QuickActions } from './QuickActions'
import * as client from '../api/client'
import * as ownershipHook from './useCardOwnership'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import type { CardOwnership } from '../api/client'

const CARD = { id: 'base1-4', name: 'Charizard', set: { id: 'base1' }, number: '4' }

const EMPTY: CardOwnership = { collections: [], wishlists: [] }
const WANTED: CardOwnership = { collections: [], wishlists: [{ id: 1, name: 'Chase list' }] }
const OWNED: CardOwnership = {
  collections: [{ id: 1, name: 'Binder', quantity: 1, purpose: 'personal' }],
  wishlists: [],
}

describe('QuickActions (#761)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
    vi.spyOn(ownershipHook, 'invalidateOwnership').mockImplementation(() => {})
    vi.spyOn(client, 'wantCard').mockResolvedValue({} as never)
    vi.spyOn(client, 'unwantCard').mockResolvedValue({} as never)
    vi.spyOn(client, 'ownCard').mockResolvedValue({} as never)
    vi.spyOn(client, 'unownCard').mockResolvedValue({} as never)
    // A save refreshes the affected library list cache (#762).
    vi.spyOn(client, 'fetchCollections').mockResolvedValue([])
    vi.spyOn(client, 'fetchWishlists').mockResolvedValue([])
  })

  it('renders nothing when show is false', () => {
    const { container } = render(<QuickActions card={CARD} ownership={EMPTY} show={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('disables the toggles while ownership is still loading (#767)', () => {
    // `undefined` = the batched lookup is in flight; tapping now could pick the
    // wrong action, so both buttons stay disabled until it resolves.
    render(<QuickActions card={CARD} ownership={undefined} show />)
    expect(screen.getByRole('button', { name: /^want$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^own$/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^want$/i }))
    expect(client.wantCard).not.toHaveBeenCalled()
  })

  it('wants a card and busts the ownership cache', async () => {
    render(<QuickActions card={CARD} ownership={EMPTY} show />)
    fireEvent.click(screen.getByRole('button', { name: /^want$/i }))
    await waitFor(() => expect(client.wantCard).toHaveBeenCalledWith(CARD))
    expect(ownershipHook.invalidateOwnership).toHaveBeenCalled()
  })

  it('unwants when already wanted', async () => {
    render(<QuickActions card={CARD} ownership={WANTED} show />)
    const want = screen.getByRole('button', { name: /want/i })
    expect(want).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(want)
    await waitFor(() => expect(client.unwantCard).toHaveBeenCalledWith(CARD))
    expect(client.wantCard).not.toHaveBeenCalled()
  })

  it('owns a card', async () => {
    render(<QuickActions card={CARD} ownership={EMPTY} show />)
    fireEvent.click(screen.getByRole('button', { name: /^own$/i }))
    await waitFor(() => expect(client.ownCard).toHaveBeenCalledWith(CARD))
  })

  it('refreshes the affected library list after a save so the default marker stays live (#762)', async () => {
    render(<QuickActions card={CARD} ownership={EMPTY} show />)
    fireEvent.click(screen.getByRole('button', { name: /^own$/i }))
    // Own → collections list refreshes (where the default Own marker lives).
    await waitFor(() => expect(client.fetchCollections).toHaveBeenCalled())
    expect(client.fetchWishlists).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^want$/i }))
    await waitFor(() => expect(client.fetchWishlists).toHaveBeenCalled())
  })

  it('unowns when already owned', async () => {
    render(<QuickActions card={CARD} ownership={OWNED} show />)
    const own = screen.getByRole('button', { name: /own/i })
    expect(own).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(own)
    await waitFor(() => expect(client.unownCard).toHaveBeenCalledWith(CARD))
    expect(client.ownCard).not.toHaveBeenCalled()
  })
})
