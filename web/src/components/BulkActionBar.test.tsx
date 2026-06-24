import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BulkActionBar } from './BulkActionBar'
import * as client from '../api/client'
import * as ownershipHook from './useCardOwnership'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import type { Row } from '../types'

const CARD_A = { id: 'base1-4', name: 'Charizard', set: { id: 'base1' }, number: '4' }
const CARD_B = { id: 'base1-2', name: 'Blastoise', set: { id: 'base1' }, number: '2' }

function makeRow(over: Partial<Row> = {}): Row {
  return {
    query: { raw: '', name: '' } as Row['query'],
    card: null,
    pricing: { market: null, currency: 'USD', variant: null, source: null, url: null },
    tag: '',
    matched: true,
    reason: '',
    ...over,
  }
}

function renderBar(props: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) {
  return render(
    <BulkActionBar
      selectedRows={[
        makeRow({ card: CARD_A as Row['card'] }),
        makeRow({ card: CARD_B as Row['card'] }),
      ]}
      onClear={() => {}}
      onDelete={() => {}}
      onRetag={() => {}}
      canUndo={false}
      onUndo={() => {}}
      showBinderActions
      {...props}
    />,
  )
}

describe('BulkActionBar quick-action save (#781)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
    vi.spyOn(ownershipHook, 'invalidateOwnership').mockImplementation(() => {})
    vi.spyOn(client, 'wantCard').mockResolvedValue({} as never)
    vi.spyOn(client, 'ownCard').mockResolvedValue({} as never)
    // The bulk save refreshes the affected library cache on success.
    vi.spyOn(client, 'fetchCollections').mockResolvedValue([])
    vi.spyOn(client, 'fetchWishlists').mockResolvedValue([])
  })

  it('owns every selected matched card and refreshes the collections cache', async () => {
    renderBar()
    // Drop the mount-time refresh so we can assert the post-save one.
    await waitFor(() => expect(client.fetchCollections).toHaveBeenCalled())
    vi.mocked(client.fetchCollections).mockClear()

    fireEvent.click(screen.getByRole('button', { name: /own selected cards/i }))
    await waitFor(() => expect(client.ownCard).toHaveBeenCalledTimes(2))
    expect(client.ownCard).toHaveBeenCalledWith(CARD_A)
    expect(client.ownCard).toHaveBeenCalledWith(CARD_B)
    expect(ownershipHook.invalidateOwnership).toHaveBeenCalled()
    // Binder counts / insights stay live (#781 review).
    await waitFor(() => expect(client.fetchCollections).toHaveBeenCalled())
  })

  it('wants every selected matched card and refreshes the wishlists cache', async () => {
    renderBar()
    await waitFor(() => expect(client.fetchWishlists).toHaveBeenCalled())
    vi.mocked(client.fetchWishlists).mockClear()

    fireEvent.click(screen.getByRole('button', { name: /want selected cards/i }))
    await waitFor(() => expect(client.wantCard).toHaveBeenCalledTimes(2))
    expect(client.wantCard).toHaveBeenCalledWith(CARD_A)
    expect(client.wantCard).toHaveBeenCalledWith(CARD_B)
    await waitFor(() => expect(client.fetchWishlists).toHaveBeenCalled())
  })

  it('clears the selection after a successful save', async () => {
    const onClear = vi.fn()
    renderBar({ onClear })
    fireEvent.click(screen.getByRole('button', { name: /own selected cards/i }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
  })

  it('only saves matched rows, skipping no-match rows', async () => {
    renderBar({
      selectedRows: [
        makeRow({ card: CARD_A as Row['card'] }),
        makeRow({ matched: false, card: null }),
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: /own selected cards/i }))
    await waitFor(() => expect(client.ownCard).toHaveBeenCalledTimes(1))
    expect(client.ownCard).toHaveBeenCalledWith(CARD_A)
  })

  it('hides the save toggles when binder actions are off (signed out)', () => {
    renderBar({ showBinderActions: false })
    expect(screen.queryByRole('button', { name: /own selected cards/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /want selected cards/i })).toBeNull()
  })
})
