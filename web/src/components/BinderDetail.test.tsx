import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BinderDetail } from './BinderDetail'
import { _resetBindersCacheForTests } from './useBinders'
import {
  fetchBinder,
  fetchBinders,
  fetchCollection,
  updateBinder,
  exportFile,
  type BinderSummary,
  type Collection,
  type CollectionItem,
} from '../api/client'

vi.mock('../api/client', () => ({
  fetchBinder: vi.fn(),
  fetchBinders: vi.fn(),
  fetchCollection: vi.fn(),
  updateBinder: vi.fn(),
  exportFile: vi.fn(),
}))

const mockFetchBinder = vi.mocked(fetchBinder)
const mockFetchBinders = vi.mocked(fetchBinders)
const mockFetchCollection = vi.mocked(fetchCollection)
const mockUpdateBinder = vi.mocked(updateBinder)
const mockExportFile = vi.mocked(exportFile)

const BINDER: BinderSummary = {
  id: 8,
  name: 'Show binder',
  created_at: '2026-06-20T00:00:00',
  binder_format: '4-pocket',
  binder_color: 'sky',
  binder_type: 'regular',
  capacity: 12,
  collection_count: 1,
  wishlist_count: 0,
  is_empty: false,
}

function item(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: 1,
    card: { id: 'base1-4', name: 'Charizard', images: { small: 'https://img/base1-4.png' } },
    notes: null,
    added_at: '2026-06-21T00:00:00',
    quantity: 1,
    card_set_id: 'base1',
    card_number: '4',
    card_name: 'Charizard',
    card_rarity: 'Rare Holo',
    card_image_url: 'https://img/base1-4.png',
    price_snapshot: 250,
    ...overrides,
  }
}

function collection(items: Collection['items']): Collection {
  return {
    id: 4,
    name: 'Base holos',
    description: null,
    created_at: '2026-06-21T00:00:00',
    items,
    kind: 'manual',
    binder_id: 8,
  }
}

beforeEach(() => {
  _resetBindersCacheForTests()
  mockFetchBinder.mockReset()
  mockFetchBinders.mockReset()
  mockFetchCollection.mockReset()
  mockUpdateBinder.mockReset()
  mockExportFile.mockReset()
  mockFetchBinders.mockResolvedValue([BINDER])
  mockUpdateBinder.mockResolvedValue({ ...BINDER, collections: [], wishlists: [] })
})

/**
 * Radix DropdownMenu opens on the keyboard activation path under jsdom.
 */
function openExportMenu() {
  const trigger = screen.getByRole('button', { name: 'Export' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
}

describe('BinderDetail', () => {
  it('renders owned cards as an ordered physical pocket spread and flips pages', async () => {
    mockFetchBinder.mockResolvedValue({
      ...BINDER,
      collections: [{ id: 4, name: 'Base holos', item_count: 2, total_quantity: 5 }],
      wishlists: [],
    })
    mockFetchCollection.mockResolvedValue(
      collection([
        item({ id: 1, quantity: 2, card_name: 'Charizard' }),
        item({
          id: 2,
          quantity: 3,
          card_name: 'Blastoise',
          card: { id: 'base1-2', name: 'Blastoise', images: { small: 'https://img/base1-2.png' } },
          card_image_url: 'https://img/base1-2.png',
        }),
      ]),
    )

    render(<BinderDetail binder={BINDER} open onOpenChange={() => {}} />)

    expect((await screen.findAllByText('Page 1')).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/slot 1: charizard/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/slot 4: blastoise/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/slot 5: blastoise/i)).not.toBeInTheDocument()
    expect(screen.getByText('4-pocket')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next pages/i }))

    expect(await screen.findByText('Page 2')).toBeInTheDocument()
    expect(screen.getByText('Page 3')).toBeInTheDocument()
    expect(screen.getByLabelText(/slot 5: blastoise/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/slot 8: empty/i)).toBeInTheDocument()
  })

  it('offers the shared export menu with one export row per occupied slot', async () => {
    mockFetchBinder.mockResolvedValue({
      ...BINDER,
      collections: [{ id: 4, name: 'Base holos', item_count: 1, total_quantity: 2 }],
      wishlists: [],
    })
    mockFetchCollection.mockResolvedValue(collection([item({ id: 1, quantity: 2 })]))

    render(<BinderDetail binder={BINDER} open onOpenChange={() => {}} />)

    await screen.findByLabelText(/slot 1: charizard/i)
    openExportMenu()

    expect(screen.getByText('PDF binder')).toBeInTheDocument()
    expect(screen.getByText('2 rows')).toBeInTheDocument()
  })
})
