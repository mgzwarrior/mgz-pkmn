import { describe, it, expect } from 'vitest'
import {
  cardCategories,
  inCategory,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type CardCategory,
} from './cardCategories'

describe('cardCategories', () => {
  it('flags Tag Team cards from the subtype', () => {
    expect(
      cardCategories({ name: 'Pikachu & Zekrom GX', subtypes: ['TAG TEAM', 'GX'] }),
    ).toContain('tag-team')
  })

  it('is case-insensitive on the tag team subtype', () => {
    expect(cardCategories({ name: 'X', subtypes: ['tag team'] })).toContain('tag-team')
  })

  it("flags any \"<owner>'s <Pokémon>\" name as an owner card", () => {
    expect(cardCategories({ name: "Cynthia's Garchomp" })).toContain('owner')
    expect(cardCategories({ name: "Team Rocket's Mewtwo" })).toContain('owner')
  })

  it('flags a Gym Leader owner as both gym-leader and owner', () => {
    const cats = cardCategories({ name: "Blaine's Charizard" })
    expect(cats).toContain('gym-leader')
    expect(cats).toContain('owner')
  })

  it('handles multi-word owner names like "Lt. Surge"', () => {
    expect(cardCategories({ name: "Lt. Surge's Fearow" })).toContain('gym-leader')
  })

  it("does not mistake Farfetch'd (apostrophe-d) for an owner card", () => {
    expect(cardCategories({ name: "Farfetch'd" })).not.toContain('owner')
    expect(cardCategories({ name: "Sirfetch'd V" })).not.toContain('owner')
  })

  it('flags Special Illustration Rare and Illustration Rare alike', () => {
    expect(cardCategories({ name: 'A', rarity: 'Illustration Rare' })).toContain(
      'illustration-rare',
    )
    expect(
      cardCategories({ name: 'B', rarity: 'Special Illustration Rare' }),
    ).toContain('illustration-rare')
  })

  it('flags Character Rare as an illustration archetype', () => {
    expect(cardCategories({ name: 'C', rarity: 'Character Super Rare' })).toContain(
      'illustration-rare',
    )
  })

  it('flags connecting-scene cards from the curated id seed', () => {
    expect(inCategory({ id: 'swsh5-86', name: 'Single Strike Urshifu VMAX' }, 'connecting-scene')).toBe(
      true,
    )
    expect(inCategory({ id: 'sv8-203', name: 'Latios' }, 'connecting-scene')).toBe(true)
  })

  it('does not flag a non-seeded card as connecting-scene', () => {
    expect(inCategory({ id: 'base1-4', name: 'Charizard' }, 'connecting-scene')).toBe(false)
  })

  it('returns categories in display order, most-specific first', () => {
    // A connecting-scene Gym Leader card would list connecting-scene before
    // gym-leader before owner.
    const cats = cardCategories({
      id: 'swsh5-86',
      name: "Blaine's Charizard",
      subtypes: ['TAG TEAM'],
      rarity: 'Illustration Rare',
    })
    const expectedRelativeOrder = CATEGORY_ORDER.filter((c) => cats.includes(c))
    expect(cats).toEqual(expectedRelativeOrder)
  })

  it('returns an empty list for a plain common', () => {
    expect(cardCategories({ id: 'sv1-1', name: 'Pikachu', rarity: 'Common', subtypes: ['Basic'] })).toEqual(
      [],
    )
  })

  it('tolerates null / missing fields', () => {
    expect(cardCategories({})).toEqual([])
    expect(cardCategories({ name: null, rarity: null, subtypes: null, id: null })).toEqual([])
  })

  it('has a label for every category in the order list', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[cat as CardCategory]).toBeTruthy()
    }
  })
})
