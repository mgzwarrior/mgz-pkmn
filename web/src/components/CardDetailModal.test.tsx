import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { CardDetailModal } from './CardDetailModal'
import type { Row } from '../types'
import * as client from '../api/client'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { _resetCardOwnershipForTests } from './useCardOwnership'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'

// Fabricate a minimal Row with the slots the modal reads. Tests shallow-merge
// (via spread) additional fields onto the underlying card so each one only
// states what it actually cares about. Note: nested objects like `set` and
// `images` are *replaced*, not merged — pass `undefined` to clear a default,
// or specify the full nested object when you need it.
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

  it('lets the pricing panel set a condition override', () => {
    const row = buildRow()
    const onConditionOverrideChange = vi.fn()
    render(
      <CardDetailModal
        rows={[row]}
        index={0}
        onChangeIndex={() => {}}
        onConditionOverrideChange={onConditionOverrideChange}
      />,
    )

    fireEvent.change(screen.getByLabelText(/condition for charizard/i), {
      target: { value: 'MP' },
    })

    expect(onConditionOverrideChange).toHaveBeenCalledWith(row, 'MP')
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

  it('labels the source link by the actual URL host, not card._database', () => {
    // Regression: a pokemontcg.io card with a TCGPlayer pricing URL used
    // to render "View on pokemontcg.io" pointing at tcgplayer.com. The
    // label must agree with the URL.
    const row = buildRow({
      pricing: { url: 'https://www.tcgplayer.com/product/123' },
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        set: { name: 'Base Set' },
        _database: 'pokemontcg.io',
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    const link = screen.getByRole('link', { name: /View on/ }) as HTMLAnchorElement
    expect(link.textContent).toContain('TCGPlayer')
    expect(link.textContent).not.toContain('pokemontcg.io')
    expect(link.href).toContain('tcgplayer.com')
  })

  it('labels each well-known host correctly', () => {
    const hosts: [string, string][] = [
      ['https://www.tcgplayer.com/product/1', 'TCGPlayer'],
      ['https://www.cardmarket.com/en/Pokemon/Products/1', 'Cardmarket'],
      ['https://www.pricecharting.com/game/pokemon-base-set/charizard', 'PriceCharting'],
    ]
    for (const [url, label] of hosts) {
      const { unmount } = render(
        <CardDetailModal
          rows={[buildRow({ pricing: { url } })]}
          index={0}
          onChangeIndex={() => {}}
        />,
      )
      const link = screen.getByRole('link', { name: /View on/ }) as HTMLAnchorElement
      expect(link.textContent).toContain(label)
      unmount()
    }
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

  it('prefers card.tcgplayer.url over the pokemontcg.io fallback', () => {
    const row = buildRow({
      pricing: { url: null },
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        set: { name: 'Base Set' },
        tcgplayer: { url: 'https://www.tcgplayer.com/product/from-card' },
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    const link = screen.getByRole('link', { name: /View on/ }) as HTMLAnchorElement
    expect(link.href).toBe('https://www.tcgplayer.com/product/from-card')
  })

  it('falls through to card.cardmarket.url when TCGPlayer is absent', () => {
    const row = buildRow({
      pricing: { url: null },
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        set: { name: 'Base Set' },
        cardmarket: { url: 'https://www.cardmarket.com/en/Pokemon/Products/123' },
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    const link = screen.getByRole('link', { name: /View on/ }) as HTMLAnchorElement
    expect(link.href).toBe(
      'https://www.cardmarket.com/en/Pokemon/Products/123',
    )
  })

  it('hides the source link when no URL is available anywhere', () => {
    // No pricing.url, no tcgplayer/cardmarket, no card.id — every branch of
    // deriveSourceUrl returns null. We explicitly clear the spread-merged
    // defaults with `undefined` so the test really hits the no-link path.
    const row = buildRow({
      pricing: { url: null },
      card: {
        name: 'GhostMon',
        id: undefined,
        tcgplayer: undefined,
        cardmarket: undefined,
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    expect(screen.queryByRole('link', { name: /View on/ })).toBeNull()
  })

  it('renders resistances, retreat, dex, and flavor text branches', () => {
    const row = buildRow({
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        set: { name: 'Base Set' },
        resistances: [{ type: 'Fighting', value: '-30' }],
        retreatCost: ['Colorless', 'Colorless'],
        nationalPokedexNumbers: [6],
        flavorText: 'Spits fire that is hot enough to melt boulders.',
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    expect(screen.getByText('Fighting -30')).toBeInTheDocument()
    expect(screen.getByText('Colorless · Colorless')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(
      screen.getByText(/Spits fire that is hot enough to melt boulders/),
    ).toBeInTheDocument()
  })

  it('skips identity-list rows whose value is missing', () => {
    // No series, no rarity, no variant — those <dt>/<dd> pairs should be
    // filtered out entirely (not rendered as "Series: —").
    const row = buildRow({
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        set: { name: 'Base Set' }, // no series
        rarity: undefined,
      },
      pricing: { variant: null },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    // None of these labels appear because every value was null/missing.
    expect(screen.queryByText('Series')).toBeNull()
    expect(screen.queryByText('Rarity')).toBeNull()
    expect(screen.queryByText('Variant')).toBeNull()
    // But the rows that DO have values still render.
    expect(screen.getByText('Set')).toBeInTheDocument()
    expect(screen.getByText('Base Set')).toBeInTheDocument()
  })

  it('shows "—" for the market price line when pricing is unavailable', () => {
    const row = buildRow({
      pricing: { market: null, source: null, url: null },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    // Every comp line and the market price line should fall back to the
    // em-dash sentinel; sanity check by asserting we see the dash and not
    // a dollar value.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5)
    expect(screen.queryByText(/^\$/)).toBeNull()
  })

  it('header navigation buttons advance the modal', () => {
    const rows = [
      buildRow({ card: { name: 'Charizard', id: 'a', set: { name: 'Base' } } }),
      buildRow({ card: { name: 'Blastoise', id: 'b', set: { name: 'Base' } } }),
    ]
    const onChange = vi.fn()
    render(<CardDetailModal rows={rows} index={0} onChangeIndex={onChange} />)
    fireEvent.click(screen.getByLabelText('Next card'))
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('header navigation buttons are disabled at the ends of the row set', () => {
    const rows = [
      buildRow({ card: { name: 'Charizard', id: 'a', set: { name: 'Base' } } }),
      buildRow({ card: { name: 'Blastoise', id: 'b', set: { name: 'Base' } } }),
    ]
    const { rerender } = render(
      <CardDetailModal rows={rows} index={0} onChangeIndex={() => {}} />,
    )
    expect(screen.getByLabelText('Previous card')).toBeDisabled()
    expect(screen.getByLabelText('Next card')).not.toBeDisabled()
    rerender(<CardDetailModal rows={rows} index={1} onChangeIndex={() => {}} />)
    expect(screen.getByLabelText('Previous card')).not.toBeDisabled()
    expect(screen.getByLabelText('Next card')).toBeDisabled()
  })

  it('resets to null when the parent row set shrinks below the current index', async () => {
    // The bug this guards against: user opens the modal on row 5, then
    // applies a filter that drops the row set to 2 entries. The stale
    // index would visually close the modal but stay set in state — and
    // if rows.length later grew back past index, the modal would silently
    // reopen. The reset effect must force `onChangeIndex(null)`.
    const rows = [
      buildRow({ card: { name: 'Charizard', id: 'a', set: { name: 'Base' } } }),
      buildRow({ card: { name: 'Blastoise', id: 'b', set: { name: 'Base' } } }),
      buildRow({ card: { name: 'Venusaur', id: 'c', set: { name: 'Base' } } }),
    ]
    const onChange = vi.fn()
    const { rerender } = render(
      <CardDetailModal rows={rows} index={2} onChangeIndex={onChange} />,
    )
    // Sanity check: modal is open at index 2.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Now the parent filters to 1 row — index 2 is out of bounds.
    rerender(
      <CardDetailModal rows={rows.slice(0, 1)} index={2} onChangeIndex={onChange} />,
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
  })

  it('uses the query name as a fallback when card.name is missing', () => {
    const row = buildRow({
      query: { name: 'MissingMon', raw: 'MissingMon' } as Row['query'],
      card: {
        // no name field — Dialog.Title and image alt should fall back to query.name
        id: 'unknown',
        set: { name: 'Unknown Set' },
        name: undefined,
      },
    })
    render(
      <CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />,
    )
    // The title and the identity Name row both render the fallback.
    expect(screen.getAllByText('MissingMon').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the eBay comps section with median, floor, and raw comps when present', () => {
    const row = buildRow({
      pricing: {
        ebay_sold_median: 230,
        ebay_active_floor: 199.99,
        ebay_sold_comps: [
          { price: 220, date: '2026-01-01', condition: 'Used', url: null },
          { price: 240, date: '2026-02-01', condition: 'Near Mint', url: null },
        ],
      },
    })
    render(<CardDetailModal rows={[row]} index={0} onChangeIndex={() => {}} />)
    expect(screen.getByText('eBay comps')).toBeInTheDocument()
    expect(screen.getByText('$230.00')).toBeInTheDocument() // sold median
    expect(screen.getByText('$199.99')).toBeInTheDocument() // active floor
    // Raw comps surface date + condition.
    expect(screen.getByText('2026-02-01')).toBeInTheDocument()
    expect(screen.getByText('Near Mint')).toBeInTheDocument()
    // Sparkline summarises the series.
    expect(screen.getByRole('img', { name: /recent ebay sold prices/i })).toBeInTheDocument()
  })

  it('omits the eBay comps section when there is no eBay data', () => {
    render(<CardDetailModal rows={[buildRow()]} index={0} onChangeIndex={() => {}} />)
    expect(screen.queryByText('eBay comps')).toBeNull()
  })

  it('renders Buy links out to eBay and TCGPlayer with the affiliate rel', () => {
    render(<CardDetailModal rows={[buildRow()]} index={0} onChangeIndex={() => {}} />)
    expect(screen.getByText('Buy')).toBeInTheDocument()
    const ebay = screen.getByTitle('Find on eBay')
    const tcg = screen.getByTitle('Find on TCGPlayer')
    expect(ebay).toHaveAttribute('href', expect.stringContaining('ebay.com/sch'))
    expect(ebay).toHaveAttribute('href', expect.stringContaining('Charizard'))
    expect(ebay).toHaveAttribute('rel', 'sponsored noopener')
    expect(ebay).toHaveAttribute('target', '_blank')
    expect(within(ebay).getByAltText('eBay')).toHaveAttribute('src', expect.stringContaining('svg'))
    // Routed through the TCGPlayer Impact tracking redirect (#696).
    expect(tcg).toHaveAttribute('href', expect.stringContaining('partner.tcgplayer.com/c/'))
    expect(tcg).toHaveAttribute('rel', 'sponsored noopener')
    expect(within(tcg).getByAltText('TCGplayer')).toHaveAttribute('src', expect.stringContaining('svg'))
  })

  it('omits the Buy block when the card has no name to search on', () => {
    render(
      <CardDetailModal rows={[buildRow({ card: null })]} index={0} onChangeIndex={() => {}} />,
    )
    expect(screen.queryByText('Buy')).toBeNull()
  })
})

describe('CardDetailModal — library actions (#699)', () => {
  // A card carrying a set id so the ownership lookup (keyed by set::number)
  // resolves; the default fixture only has a set name.
  function identifiedRow() {
    return buildRow({
      card: {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        set: { id: 'base1', name: 'Base Set', series: 'Base' },
        images: { large: 'https://example.com/charizard-large.png' },
      },
    })
  }

  beforeEach(() => {
    _resetAuthStoreForTests()
    _resetCardOwnershipForTests()
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
    vi.spyOn(client, 'fetchMe').mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })
    vi.spyOn(client, 'fetchCollections').mockResolvedValue([])
    vi.spyOn(client, 'fetchWishlists').mockResolvedValue([])
    vi.spyOn(client, 'fetchCardOwnership').mockResolvedValue({})
  })

  it('renders the one-tap want / own quick actions when signed in (#761)', async () => {
    render(<CardDetailModal rows={[identifiedRow()]} index={0} onChangeIndex={() => {}} />)
    expect(await screen.findByRole('region', { name: /Library actions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^want$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^own$/i })).toBeInTheDocument()
  })

  it('hides the save actions when signed out', async () => {
    vi.spyOn(client, 'fetchMe').mockRejectedValue(new Error('401'))
    render(<CardDetailModal rows={[identifiedRow()]} index={0} onChangeIndex={() => {}} />)
    // Let the auth probe settle, then assert the actions never mounted.
    await waitFor(() => expect(client.fetchMe).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /^own$/i })).toBeNull()
    expect(screen.queryByRole('region', { name: /Library actions/i })).toBeNull()
  })

  it('shows owned (with quantity) and hides the chase badge once owned (#761)', async () => {
    vi.spyOn(client, 'fetchCardOwnership').mockResolvedValue({
      'base1::4': {
        collections: [{ id: 1, name: 'Show binder', quantity: 2, purpose: 'personal' }],
        wishlists: [{ id: 1, name: 'Chase list' }],
      },
    })
    render(<CardDetailModal rows={[identifiedRow()]} index={0} onChangeIndex={() => {}} />)
    expect(await screen.findByText(/owned ×2/i)).toBeInTheDocument()
    // Owned supersedes chasing: the chase badge is gone, but the want-list
    // still surfaces in the library-locations chips (#753).
    expect(screen.queryByTitle(/Chasing on Chase list/i)).toBeNull()
    const locations = screen.getByLabelText(/Library locations/i)
    expect(within(locations).getByText('Chase list')).toBeInTheDocument()
  })

  it('surfaces the named collections and want-lists a card belongs to', async () => {
    vi.spyOn(client, 'fetchCardOwnership').mockResolvedValue({
      'base1::4': {
        collections: [
          { id: 1, name: 'Base Set masters', quantity: 1, purpose: 'personal' },
          { id: 2, name: 'Trade binder', quantity: 3, purpose: 'personal' },
        ],
        wishlists: [{ id: 3, name: 'Allentown chase list' }],
      },
    })

    render(<CardDetailModal rows={[identifiedRow()]} index={0} onChangeIndex={() => {}} />)

    const locations = await screen.findByLabelText(/Library locations/i)
    expect(within(locations).getByText('In:')).toBeInTheDocument()
    expect(within(locations).getByText('Base Set masters')).toBeInTheDocument()
    expect(within(locations).getByText('Trade binder ×3')).toBeInTheDocument()
    expect(within(locations).getByText('Want:')).toBeInTheDocument()
    expect(within(locations).getByText('Allentown chase list')).toBeInTheDocument()
  })

  it('removes the card from a specific collection via the location chip (#762)', async () => {
    vi.spyOn(client, 'fetchCardOwnership').mockResolvedValue({
      'base1::4': { collections: [{ id: 7, name: 'Show binder', quantity: 2, purpose: 'personal' }], wishlists: [] },
    })
    const removeSpy = vi.spyOn(client, 'removeCardFromCollection').mockResolvedValue()

    render(<CardDetailModal rows={[identifiedRow()]} index={0} onChangeIndex={() => {}} />)
    const locations = await screen.findByLabelText(/Library locations/i)
    fireEvent.click(
      within(locations).getByRole('button', { name: /Remove from collection Show binder/i }),
    )

    // Removal targets the card identity, not an item id.
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith(7, 'base1', '4'))
  })

  it('removes the card from a specific want-list via the location chip (#762)', async () => {
    vi.spyOn(client, 'fetchCardOwnership').mockResolvedValue({
      'base1::4': { collections: [], wishlists: [{ id: 9, name: 'Chase list' }] },
    })
    const removeSpy = vi.spyOn(client, 'removeCardFromWishlist').mockResolvedValue()

    render(<CardDetailModal rows={[identifiedRow()]} index={0} onChangeIndex={() => {}} />)
    const locations = await screen.findByLabelText(/Library locations/i)
    fireEvent.click(
      within(locations).getByRole('button', { name: /Remove from wishlist Chase list/i }),
    )

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith(9, 'base1', '4'))
  })
})
