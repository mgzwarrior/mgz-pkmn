import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CardDetailModal } from './CardDetailModal'
import type { Row } from '../types'

// Fabricate a minimal Row with the slots the modal reads. Tests then deep-merge
// additional fields onto the underlying card so each one only states what it
// actually cares about.
function buildRow(
  overrides: {
    card?: Record<string, unknown> | null
    pricing?: Partial<Row['pricing']>
    query?: Partial<Row['query']>
    matched?: boolean
  } = {},
): Row {
  return {
    query: {
      raw: 'Charizard',
      name: 'Charizard',
      set_hint: null,
      number: null,
      variant_hint: null,
      url_hint: null,
      bulk_top: null,
      bulk_all: false,
      price_min: null,
      price_max: null,
      ...overrides.query,
    },
    card: overrides.card === null
      ? null
      : {
          id: 'base1-4',
          name: 'Charizard',
          number: '4',
          rarity: 'Rare Holo',
          set: { name: 'Base Set', series: 'Base' },
          images: {
            small: 'https://example.com/charizard-small.png',
            large: 'https://example.com/charizard-large.png',
          },
          _database: 'pokemontcg.io',
          ...overrides.card,
        },
    pricing: {
      market: 250,
      variant: null,
      source: 'TCGPlayer',
      url: 'https://www.tcgplayer.com/product/123',
      currency: 'USD',
      ...overrides.pricing,
    },
    tag: '',
    matched: overrides.matched ?? true,
    reason: 'matched',
  }
}

describe('CardDetailModal', () => {
  it('does not render when index is null', () => {
    render(
      <CardDetailModal
        rows={[buildRow()]}
        index={null}
        onChangeIndex={() => {}}
      />,
    )
    // Dialog content is portaled, but the title would land in the document
    // body when open. None of those landmarks should exist when closed.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the card name, set, large image, and pricing', () => {
    render(
      <CardDetailModal
        rows={[buildRow()]}
        index={0}
        onChangeIndex={() => {}}
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Header pulls the name + the 1/N counter. "Charizard" appears in the
    // title, the identity list, and the image alt — `getAllByText` for
    // the count, then a role-scoped query for the title specifically.
    expect(screen.getAllByText('Charizard').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    // Identity grid shows the set name + number.
    expect(screen.getByText('Base Set')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    // Large image preferred over small.
    const img = screen.getByAltText('Charizard') as HTMLImageElement
    expect(img.src).toContain('charizard-large.png')
    // Market price + all four comp tiers render.
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.getByText('$237.50')).toBeInTheDocument() // 95%
    expect(screen.getByText('$225.00')).toBeInTheDocument() // 90%
    expect(screen.getByText('$212.50')).toBeInTheDocument() // 85%
    expect(screen.getByText('$200.00')).toBeInTheDocument() // 80%
  })

  it('falls back to images.small when large is missing', () => {
    const row = buildRow({
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        set: { name: 'Base Set' },
        images: { small: 'https://example.com/charizard-small.png' },
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    const img = screen.getByAltText('Charizard') as HTMLImageElement
    expect(img.src).toContain('charizard-small.png')
  })

  it('shows "No image available" placeholder when both images are missing', () => {
    // `buildRow`'s deep default merges `images` onto whatever the override
    // ships — so we explicitly clear it with `undefined` to simulate the
    // no-images case.
    const row = buildRow({
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        set: { name: 'Base Set' },
        images: undefined,
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    expect(screen.getByText('No image available')).toBeInTheDocument()
  })

  it('renders optional card metadata (attacks, HP, weaknesses) when present', () => {
    const row = buildRow({
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        set: { name: 'Base Set' },
        supertype: 'Pokémon',
        subtypes: ['Stage 2'],
        hp: '120',
        types: ['Fire'],
        attacks: [
          {
            name: 'Fire Spin',
            cost: ['Fire', 'Fire', 'Fire', 'Fire'],
            damage: '100',
            text: 'Discard 2 Energy attached to this Pokémon.',
          },
        ],
        weaknesses: [{ type: 'Water', value: '×2' }],
        artist: 'Mitsuhiro Arita',
        regulationMark: 'G',
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    expect(screen.getByText('Card data')).toBeInTheDocument()
    expect(screen.getByText('Fire Spin')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText(/Discard 2 Energy/)).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument() // HP
    expect(screen.getByText('Water ×2')).toBeInTheDocument()
    expect(screen.getByText('Mitsuhiro Arita')).toBeInTheDocument()
    expect(screen.getByText('G')).toBeInTheDocument()
  })

  it('handles a sparse card with no optional metadata fields', () => {
    const row = buildRow({
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        set: { name: 'Base Set' },
        // No attacks, hp, types, etc. — modal must not crash.
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    // The "Card data" section short-circuits to a placeholder message.
    expect(
      screen.getByText(/No additional card data was returned/),
    ).toBeInTheDocument()
    // The identity / pricing sections still render fine. "Charizard" lands
    // in multiple slots (title, identity list, image alt) so we just check
    // the dialog is up and the price line is correct.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('$250.00')).toBeInTheDocument()
  })

  it('navigates via ArrowRight / ArrowLeft', async () => {
    const rows = [
      buildRow({ card: { name: 'Charizard', id: 'a', set: { name: 'Base' } } }),
      buildRow({ card: { name: 'Blastoise', id: 'b', set: { name: 'Base' } } }),
      buildRow({ card: { name: 'Venusaur', id: 'c', set: { name: 'Base' } } }),
    ]
    const onChange = vi.fn()
    render(<CardDetailModal rows={rows} index={1} onChangeIndex={onChange} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('does not navigate past the ends of the row set', () => {
    const rows = [
      buildRow({ card: { name: 'Charizard', id: 'a', set: { name: 'Base' } } }),
      buildRow({ card: { name: 'Blastoise', id: 'b', set: { name: 'Base' } } }),
    ]
    const onChange = vi.fn()
    // At the start — left arrow is a no-op.
    const { rerender } = render(
      <CardDetailModal rows={rows} index={0} onChangeIndex={onChange} />,
    )
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onChange).not.toHaveBeenCalled()
    // At the end — right arrow is a no-op.
    rerender(<CardDetailModal rows={rows} index={1} onChangeIndex={onChange} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes when the close button is clicked', async () => {
    const onChange = vi.fn()
    render(
      <CardDetailModal
        rows={[buildRow()]}
        index={0}
        onChangeIndex={onChange}
      />,
    )
    fireEvent.click(screen.getByLabelText('Close'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
  })

  it('renders the source link to the best available URL', () => {
    const row = buildRow({
      pricing: { url: 'https://www.tcgplayer.com/product/123' },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    const link = screen.getByRole('link', { name: /View on/ }) as HTMLAnchorElement
    expect(link.href).toBe('https://www.tcgplayer.com/product/123')
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  it('falls back to a pokemontcg.io card URL when no pricing.url exists', () => {
    const row = buildRow({
      pricing: { url: null },
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        set: { name: 'Base Set' },
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    const link = screen.getByRole('link', { name: /View on/ }) as HTMLAnchorElement
    expect(link.href).toBe('https://pokemontcg.io/cards/base1-4')
  })
})
