import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { LibraryBindersTab } from './LibraryBindersTab'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import { _resetBindersCacheForTests } from './useBinders'
import {
  fetchCollections,
  fetchCollection,
  createCollection,
  deleteCollection,
  downloadCollectionIdCardPdf,
  fetchWishlists,
  fetchWishlist,
  deleteWishlist,
  fetchCollectionTarget,
  fetchBinders,
  createWishlist,
  updateCollection,
  updateWishlist,
} from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  fetchCollection: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  addCardToCollection: vi.fn(),
  deleteCollection: vi.fn(),
  downloadCollectionIdCardPdf: vi.fn(),
  fetchWishlists: vi.fn(),
  createWishlist: vi.fn(),
  updateWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
  bulkAddToWishlist: vi.fn(),
  deleteWishlist: vi.fn(),
  fetchWishlist: vi.fn(),
  promoteWishlistItem: vi.fn(),
  fetchCollectionTarget: vi.fn(),
  chaseCollection: vi.fn(),
  fetchBinders: vi.fn(),
  createBinder: vi.fn(),
  updateBinder: vi.fn(),
  deleteBinder: vi.fn(),
}))

const mockCollections = vi.mocked(fetchCollections)
const mockFetchCollection = vi.mocked(fetchCollection)
const mockWishlists = vi.mocked(fetchWishlists)
const mockBinders = vi.mocked(fetchBinders)
const mockCreate = vi.mocked(createCollection)
const mockDeleteCollection = vi.mocked(deleteCollection)
const mockDeleteWishlist = vi.mocked(deleteWishlist)
const mockPrintIdCard = vi.mocked(downloadCollectionIdCardPdf)
const mockFetchWishlist = vi.mocked(fetchWishlist)
const mockTarget = vi.mocked(fetchCollectionTarget)
const mockCreateWishlist = vi.mocked(createWishlist)
const mockUpdate = vi.mocked(updateCollection)
const mockUpdateWishlist = vi.mocked(updateWishlist)

/** Open the New ▾ menu (radix opens on keyboard) and pick a menu item. */
async function openNewMenu(itemName: RegExp) {
  const trigger = screen.getByRole('button', { name: 'New' })
  trigger.focus()
  // Radix DropdownMenu.Trigger opens on Enter/Space/ArrowDown; jsdom doesn't
  // synthesize the pointer sequence a plain click would need.
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const item = await screen.findByRole('menuitem', { name: itemName })
  fireEvent.click(item)
}

/** Open the New ▾ menu and pick "Smart collection" (the modal opens smart-only). */
async function openSmartBinder() {
  await openNewMenu(/smart collection/i)
}

describe('LibraryBindersTab', () => {
  beforeEach(() => {
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
    _resetBindersCacheForTests()
    mockBinders.mockReset()
    mockBinders.mockResolvedValue([])
    mockCollections.mockReset()
    mockFetchCollection.mockReset()
    mockWishlists.mockReset()
    mockCreate.mockReset()
    mockDeleteCollection.mockReset()
    mockDeleteWishlist.mockReset()
    mockPrintIdCard.mockReset()
    mockFetchWishlist.mockReset()
    mockTarget.mockReset()
    mockCreateWishlist.mockReset()
    mockUpdateWishlist.mockReset()
    mockCollections.mockResolvedValue([])
    mockWishlists.mockResolvedValue([])
  })

  it('shows the combined empty state when there are no binders', async () => {
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())
    expect(
      await screen.findByText(/You don't have any binders yet/i),
    ).toBeInTheDocument()
  })

  it('interleaves owned collections and chasing want-lists newest-first with kind badges', async () => {
    mockCollections.mockResolvedValue([
      {
        id: 1,
        name: 'Charizard masters',
        description: 'all the holos',
        created_at: '2026-06-04T00:00:00',
        item_count: 4,
      },
    ])
    mockWishlists.mockResolvedValue([
      {
        id: 2,
        name: 'Mew hunt',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 3,
        binder_id: null,
      },
    ])
    render(<LibraryBindersTab />)

    await waitFor(() =>
      expect(screen.getByText('Charizard masters')).toBeInTheDocument(),
    )
    expect(screen.getByText('Mew hunt')).toBeInTheDocument()
    // "Owned"/"Chasing" also label the filter radios, so scope the kind
    // badge assertions to the list itself.
    const list = screen.getByRole('list')
    expect(within(list).getByText('Owned')).toBeInTheDocument()
    expect(within(list).getByText('Chasing')).toBeInTheDocument()
    expect(screen.getByText('4 cards')).toBeInTheDocument()
    expect(screen.getByText('3 cards')).toBeInTheDocument()

    // Newest-first: the want-list (06-06) sorts above the collection (06-04).
    const names = screen.getAllByText(/Charizard masters|Mew hunt/)
    expect(names.map((n) => n.textContent)).toEqual(['Mew hunt', 'Charizard masters'])
  })

  it('marks the default collection / want-list and leaves the rest plain (#762)', async () => {
    mockCollections.mockResolvedValue([
      { id: 1, name: 'My collection', description: null, created_at: '2026-06-04T00:00:00', item_count: 1, is_default: true },
      { id: 2, name: 'Trade binder', description: null, created_at: '2026-06-03T00:00:00', item_count: 0, is_default: false },
    ])
    mockWishlists.mockResolvedValue([
      { id: 3, name: 'My want-list', description: null, created_at: '2026-06-06T00:00:00', item_count: 2, binder_id: null, is_default: true },
    ])
    render(<LibraryBindersTab />)

    await waitFor(() => expect(screen.getByText('My collection')).toBeInTheDocument())
    // One marker on the default collection, one on the default want-list.
    expect(screen.getAllByText('default')).toHaveLength(2)
    // The plain collection carries no marker.
    const tradeRow = screen.getByText('Trade binder').closest('li')!
    expect(within(tradeRow).queryByText('default')).toBeNull()
  })

  it('filters to owned binders only', async () => {
    mockCollections.mockResolvedValue([
      { id: 1, name: 'Charizard masters', description: null, created_at: '2026-06-04T00:00:00', item_count: 4 },
    ])
    mockWishlists.mockResolvedValue([
      { id: 2, name: 'Mew hunt', description: null, created_at: '2026-06-06T00:00:00', item_count: 3, binder_id: null },
    ])
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Mew hunt')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('radio', { name: /^owned$/i }))

    expect(screen.getByText('Charizard masters')).toBeInTheDocument()
    expect(screen.queryByText('Mew hunt')).not.toBeInTheDocument()
  })

  it('filters to chasing binders only', async () => {
    mockCollections.mockResolvedValue([
      { id: 1, name: 'Charizard masters', description: null, created_at: '2026-06-04T00:00:00', item_count: 4 },
    ])
    mockWishlists.mockResolvedValue([
      { id: 2, name: 'Mew hunt', description: null, created_at: '2026-06-06T00:00:00', item_count: 3, binder_id: null },
    ])
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Charizard masters')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('radio', { name: /^chasing$/i }))

    expect(screen.getByText('Mew hunt')).toBeInTheDocument()
    expect(screen.queryByText('Charizard masters')).not.toBeInTheDocument()
  })

  it('surfaces a fetch error', async () => {
    mockCollections.mockRejectedValue(new Error('network down'))
    render(<LibraryBindersTab />)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network down/i),
    )
  })

  it('renders a smart pill for rule-based collections', async () => {
    mockCollections.mockResolvedValue([
      {
        id: 1,
        name: 'All Eevees',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 3,
        kind: 'dynamic',
        source_set_id: null,
        rule: { name: 'eevee' },
      },
    ])
    render(<LibraryBindersTab />)
    await waitFor(() =>
      expect(screen.getByText('All Eevees')).toBeInTheDocument(),
    )
    expect(screen.getByText('smart')).toBeInTheDocument()
  })

  it('renders a binder row with its format, capacity fill, and edit affordance', async () => {
    mockCollections.mockResolvedValue([
      {
        id: 2,
        name: 'Trade binder',
        description: null,
        created_at: '2026-06-12T00:00:00',
        item_count: 90,
        kind: 'binder',
        source_set_id: null,
        rule: null,
        binder_color: 'sky',
        binder_format: '9-pocket',
        capacity: 360,
        is_master_set: false,
      },
    ])
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Trade binder')).toBeInTheDocument())

    expect(screen.getByText('9-pocket')).toBeInTheDocument()
    // Capacity fill renders held / capacity.
    expect(screen.getByText('/ 360')).toBeInTheDocument()
    // The edit affordance opens the modal in edit mode (prefilled name).
    fireEvent.click(screen.getByRole('button', { name: /edit binder "trade binder"/i }))
    expect(screen.getByRole('heading', { name: /edit binder/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Trade binder')).toBeInTheDocument()
  })

  it('wraps row content instead of overflowing on narrow viewports (#844)', async () => {
    // A master-set binder stacks the most identity chips a row can carry
    // (storage type + format + master-set) alongside a capacity-fill widget
    // and four action icons — the exact combination that overflowed the
    // 375px viewport before this fix, clipping the trailing delete icon
    // off-canvas and squeezing badges into the capacity-fill column.
    mockCollections.mockResolvedValue([
      {
        id: 2,
        name: 'Charlotte show binder',
        description: null,
        created_at: '2026-06-12T00:00:00',
        item_count: 0,
        kind: 'binder',
        source_set_id: null,
        rule: null,
        binder_color: 'ember',
        binder_type: 'toploader',
        binder_format: '9-pocket',
        capacity: 360,
        is_master_set: true,
      },
    ])
    render(<LibraryBindersTab />)
    await waitFor(() =>
      expect(screen.getByText('Charlotte show binder')).toBeInTheDocument(),
    )

    // The row wraps its trailing action icons onto a new line instead of
    // pushing them past the viewport edge.
    const row = screen.getByText('Charlotte show binder').closest('li')!
    expect(row).toHaveClass('flex-wrap')

    // The flexible name button shrinks (rather than forcing its badge row
    // to overflow into the capacity-fill widget beside it).
    const nameButton = screen.getByText('Charlotte show binder').closest('button')!
    expect(nameButton).toHaveClass('min-w-0')

    // The badge/chip cluster (swatch, name, storage type, format, master
    // set) wraps independently so it can't spill past its own box.
    const badgeRow = screen.getByText('Charlotte show binder').parentElement!
    expect(badgeRow).toHaveClass('flex-wrap')
  })

  it('creates a dynamic collection from the smart-collection path in the binder modal', async () => {
    mockCreate.mockResolvedValue({
      id: 9,
      name: 'All Eevees',
      description: null,
      created_at: '2026-06-11T00:00:00',
      items: [],
      kind: 'dynamic',
      source_set_id: null,
      rule: { name: 'Eevee' },
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())

    await openSmartBinder()
    fireEvent.change(screen.getByPlaceholderText('All Eevees'), {
      target: { value: 'All Eevees' },
    })
    fireEvent.change(screen.getByPlaceholderText('Eevee'), {
      target: { value: 'Eevee' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'All Eevees',
        expect.objectContaining({
          kind: 'dynamic',
          rule: { name: 'Eevee' },
          dynamic_scope: 'owned',
        }),
      ),
    )
  })

  it('creates a catalog-scope target when the scope toggle is flipped', async () => {
    mockCreate.mockResolvedValue({
      id: 9,
      name: 'All Eevees',
      description: null,
      created_at: '2026-06-11T00:00:00',
      items: [],
      kind: 'dynamic',
      source_set_id: null,
      rule: { name: 'Eevee' },
      dynamic_scope: 'catalog',
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())

    await openSmartBinder()
    fireEvent.change(screen.getByPlaceholderText('All Eevees'), {
      target: { value: 'All Eevees' },
    })
    fireEvent.change(screen.getByPlaceholderText('Eevee'), {
      target: { value: 'Eevee' },
    })
    fireEvent.click(screen.getByRole('radio', { name: /whole catalog/i }))
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'All Eevees',
        expect.objectContaining({
          kind: 'dynamic',
          rule: { name: 'Eevee' },
          dynamic_scope: 'catalog',
        }),
      ),
    )
  })

  it('opens the target modal for a catalog-scope collection', async () => {
    mockCollections.mockResolvedValue([
      {
        id: 7,
        name: 'All Eevees',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 3,
        kind: 'dynamic',
        source_set_id: null,
        rule: { name: 'eevee' },
        dynamic_scope: 'catalog',
      },
    ])
    mockTarget.mockResolvedValue({
      id: 7,
      name: 'All Eevees',
      rule: { name: 'eevee' },
      total: 3,
      owned_count: 1,
      cards: [
        { card: { id: 'sv1-130', name: 'Eevee' }, card_set_id: 'sv1', card_number: '130', owned: true, owned_quantity: 1 },
        { card: { id: 'sv4-167', name: 'Eevee ex' }, card_set_id: 'sv4', card_number: '167', owned: false, owned_quantity: 0 },
        { card: { id: 'swsh7-186', name: 'Eevee VMAX' }, card_set_id: 'swsh7', card_number: '186', owned: false, owned_quantity: 0 },
      ],
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('target')).toBeInTheDocument())

    fireEvent.click(screen.getByText('All Eevees'))

    await waitFor(() => expect(mockTarget).toHaveBeenCalledWith(7, undefined))
    await waitFor(() =>
      expect(screen.getByText(/of 3 owned/)).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: /add 2 missing to wishlist/i }),
    ).toBeInTheDocument()
  })

  it('opens a plain collection card-list detail when its row is clicked (#723)', async () => {
    mockCollections.mockResolvedValue([
      {
        id: 4,
        name: 'Base holos',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 1,
        kind: 'manual',
      },
    ])
    mockFetchCollection.mockResolvedValue({
      id: 4,
      name: 'Base holos',
      description: null,
      created_at: '2026-06-06T00:00:00',
      kind: 'manual',
      items: [
        {
          id: 1,
          card: { name: 'Charizard' },
          notes: null,
          added_at: '2026-06-06T00:00:00',
          card_set_id: 'base1',
          card_number: '4',
          card_name: 'Charizard',
          card_rarity: 'Rare Holo',
          price_snapshot: 250,
        },
      ],
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Base holos')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Base holos'))

    await waitFor(() => expect(mockFetchCollection).toHaveBeenCalledWith(4))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Charizard')).toBeInTheDocument()
    // $250.00 shows for the item and the snapshot total.
    expect(within(dialog).getAllByText('$250.00').length).toBeGreaterThanOrEqual(1)
  })

  it('opens the detail modal when a want-list row is clicked', async () => {
    mockWishlists.mockResolvedValue([
      {
        id: 7,
        name: 'Mew hunt',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 1,
        binder_id: null,
      },
    ])
    mockFetchWishlist.mockResolvedValue({
      id: 7,
      name: 'Mew hunt',
      description: null,
      created_at: '2026-06-06T00:00:00',
      binder_id: null,
      items: [
        {
          id: 11,
          card: { id: 'base1-4', name: 'Charizard' },
          notes: null,
          max_price: null,
          added_at: '2026-06-06T00:00:00',
          card_set_id: 'base1',
          card_number: '4',
          card_name: 'Charizard',
          card_rarity: 'Rare Holo',
          card_types: null,
          card_image_url: null,
          price_snapshot: null,
          priced_at: null,
          acquired_at: null,
          acquired_collection_item_id: null,
        },
      ],
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Mew hunt')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Mew hunt'))

    await waitFor(() =>
      expect(screen.getByText('1 still chasing · 0 landed')).toBeInTheDocument(),
    )
    expect(mockFetchWishlist).toHaveBeenCalledWith(7)
    // The card name renders inside the opened detail dialog.
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Charizard')).toBeInTheDocument()
  })

  it('deletes a collection after the inline confirm', async () => {
    mockCollections.mockResolvedValue([
      { id: 1, name: 'Charizard masters', description: null, created_at: '2026-06-04T00:00:00', item_count: 4 },
    ])
    mockDeleteCollection.mockResolvedValue(undefined)
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Charizard masters')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /^delete collection "Charizard masters"/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm delete collection "Charizard masters"/i }))

    await waitFor(() => expect(mockDeleteCollection).toHaveBeenCalledWith(1))
    await waitFor(() =>
      expect(screen.queryByText('Charizard masters')).not.toBeInTheDocument(),
    )
  })

  it('deletes a want-list after the inline confirm', async () => {
    mockWishlists.mockResolvedValue([
      { id: 2, name: 'Mew hunt', description: null, created_at: '2026-06-06T00:00:00', item_count: 3, binder_id: null },
    ])
    mockDeleteWishlist.mockResolvedValue(undefined)
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Mew hunt')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /^delete wishlist "Mew hunt"/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm delete wishlist "Mew hunt"/i }))

    await waitFor(() => expect(mockDeleteWishlist).toHaveBeenCalledWith(2))
    await waitFor(() => expect(screen.queryByText('Mew hunt')).not.toBeInTheDocument())
  })

  it('downloads the ID card for a collection', async () => {
    mockCollections.mockResolvedValue([
      { id: 1, name: 'Charizard masters', description: null, created_at: '2026-06-04T00:00:00', item_count: 4 },
    ])
    mockPrintIdCard.mockResolvedValue(undefined)
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Charizard masters')).toBeInTheDocument())

    fireEvent.click(
      screen.getByRole('button', { name: /print ID card for collection "Charizard masters"/i }),
    )

    await waitFor(() => expect(mockPrintIdCard).toHaveBeenCalledWith(1, undefined))
  })

  it('keeps the binder when the delete confirm is cancelled', async () => {
    mockCollections.mockResolvedValue([
      { id: 1, name: 'Charizard masters', description: null, created_at: '2026-06-04T00:00:00', item_count: 4 },
    ])
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Charizard masters')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /^delete collection "Charizard masters"/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel delete/i }))

    expect(mockDeleteCollection).not.toHaveBeenCalled()
    expect(screen.getByText('Charizard masters')).toBeInTheDocument()
  })

  // ---- #703: New ▾ menu + file-into-binder -------------------------------

  it('New ▾ lists Collection / Wishlist / Smart collection and no plain binder', async () => {
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())

    const trigger = screen.getByRole('button', { name: 'New' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(await screen.findByRole('menuitem', { name: /^collection/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /wishlist/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /smart collection/i })).toBeInTheDocument()
    // No standalone "binder" create — physical binders come from "Add binder".
    expect(screen.queryByRole('menuitem', { name: /^binder$/i })).not.toBeInTheDocument()
  })

  it('creates a plain collection from the New ▾ menu', async () => {
    mockCreate.mockResolvedValue({
      id: 5,
      name: 'Trade pile',
      description: null,
      created_at: '2026-06-11T00:00:00',
      items: [],
      kind: 'manual',
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())

    await openNewMenu(/^collection/i)
    // The new collection dialog (#723) uses a richer placeholder; with no
    // binders yet and no inline binder named, it creates a loose collection.
    fireEvent.change(screen.getByPlaceholderText('Base Set holos'), {
      target: { value: 'Trade pile' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Trade pile', undefined))
  })

  it('creates a want-list from the New ▾ menu', async () => {
    mockCreateWishlist.mockResolvedValue({
      id: 7,
      name: 'Chase list',
      description: null,
      created_at: '2026-06-11T00:00:00',
      binder_id: null,
      items: [],
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())

    await openNewMenu(/wishlist/i)
    fireEvent.change(screen.getByPlaceholderText('Chase cards'), {
      target: { value: 'Chase list' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(mockCreateWishlist).toHaveBeenCalledWith('Chase list', undefined))
  })

  it('the smart-collection create has no physical/smart selector', async () => {
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())

    await openSmartBinder()
    // smartOnly hides the binder-type radiogroup; the rule builder is shown.
    expect(screen.queryByRole('radiogroup', { name: /binder type/i })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('All Eevees')).toBeInTheDocument()
  })

  it('files an existing collection into a binder via the row control', async () => {
    mockCollections.mockResolvedValue([
      { id: 1, name: 'Trade pile', description: null, created_at: '2026-06-04T00:00:00', item_count: 4, kind: 'manual', binder_id: null },
    ])
    mockBinders.mockResolvedValue([
      { id: 3, name: 'Show binder', created_at: '2026-06-01T00:00:00', binder_format: null, binder_color: null, binder_type: null, capacity: null, collection_count: 0, wishlist_count: 0, is_empty: true },
    ])
    mockUpdate.mockResolvedValue({
      id: 1, name: 'Trade pile', description: null, created_at: '2026-06-04T00:00:00', items: [], kind: 'manual', binder_id: 3,
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Trade pile')).toBeInTheDocument())

    const fileBtn = screen.getByRole('button', { name: /file collection "Trade pile" into a binder/i })
    fileBtn.focus()
    fireEvent.keyDown(fileBtn, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /show binder/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(1, { binder_id: 3 }))
  })

  it('lets a filed smart collection be unfiled from the row (#775 review)', async () => {
    mockCollections.mockResolvedValue([
      {
        id: 2,
        name: 'All Eevees',
        description: null,
        created_at: '2026-06-04T00:00:00',
        item_count: 7,
        kind: 'dynamic',
        dynamic_scope: 'owned',
        rule: { name: 'eevee' },
        binder_id: 3,
      },
    ])
    mockBinders.mockResolvedValue([
      { id: 3, name: 'Show binder', created_at: '2026-06-01T00:00:00', binder_format: null, binder_color: null, binder_type: null, capacity: null, collection_count: 1, wishlist_count: 0, is_empty: false },
    ])
    mockUpdate.mockResolvedValue({
      id: 2, name: 'All Eevees', description: null, created_at: '2026-06-04T00:00:00', items: [], kind: 'dynamic', binder_id: null,
    } as never)
    render(<LibraryBindersTab />)
    // The filing control now shows for dynamic (smart) collections too.
    const fileBtn = await screen.findByRole('button', {
      name: /file collection "All Eevees" into a binder/i,
    })
    fileBtn.focus()
    fireEvent.keyDown(fileBtn, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /remove from binder/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(2, { binder_id: null }))
  })

  // ---- #774: want-lists file into binders --------------------------------

  it('files a want-list into a binder via the row control', async () => {
    mockWishlists.mockResolvedValue([
      { id: 5, name: 'Mew hunt', description: null, created_at: '2026-06-06T00:00:00', item_count: 2, binder_id: null },
    ])
    mockBinders.mockResolvedValue([
      { id: 3, name: 'Show binder', created_at: '2026-06-01T00:00:00', binder_format: null, binder_color: null, binder_type: null, capacity: null, collection_count: 0, wishlist_count: 0, is_empty: true },
    ])
    mockUpdateWishlist.mockResolvedValue({
      id: 5, name: 'Mew hunt', description: null, created_at: '2026-06-06T00:00:00', binder_id: 3, items: [],
    })
    render(<LibraryBindersTab />)

    const fileBtn = await screen.findByRole('button', {
      name: /file wishlist "Mew hunt" into a binder/i,
    })
    fileBtn.focus()
    fireEvent.keyDown(fileBtn, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /show binder/i }))

    await waitFor(() => expect(mockUpdateWishlist).toHaveBeenCalledWith(5, { binder_id: 3 }))
  })

  it('creates a want-list filed into a binder from the New ▾ menu', async () => {
    mockBinders.mockResolvedValue([
      { id: 3, name: 'Show binder', created_at: '2026-06-01T00:00:00', binder_format: null, binder_color: null, binder_type: null, capacity: 360, collection_count: 0, wishlist_count: 0, is_empty: true },
    ])
    mockCreateWishlist.mockResolvedValue({
      id: 8, name: 'Chase list', description: null, created_at: '2026-06-11T00:00:00', binder_id: 3, items: [],
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockBinders).toHaveBeenCalled())

    await openNewMenu(/wishlist/i)
    fireEvent.change(screen.getByPlaceholderText('Chase cards'), {
      target: { value: 'Chase list' },
    })
    // The shared binder-file picker is offered; pick the existing binder.
    fireEvent.click(await screen.findByRole('radio', { name: /show binder/i }))
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreateWishlist).toHaveBeenCalledWith('Chase list', { binder_id: 3 }),
    )
  })
})
