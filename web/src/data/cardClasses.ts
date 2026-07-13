/**
 * The card classes Browse's by-class view offers (#911) — Trainers, Energy,
 * and the vintage mechanics collectors chase. Ids match the registry in
 * `api/routes/classes.py`; the backend owns the pokemontcg.io query each id
 * maps to, this file owns how the picker presents them.
 */

export interface CardClassEntry {
  id: string
  label: string
  blurb: string
}

export interface CardClassGroup {
  label: string
  classes: CardClassEntry[]
}

export const CARD_CLASS_GROUPS: CardClassGroup[] = [
  {
    label: 'Trainers',
    classes: [
      {
        id: 'supporter',
        label: 'Supporters',
        blurb: 'Character cards — the full-art chase lane.',
      },
      {
        id: 'item',
        label: 'Items',
        blurb: 'Every Poké Ball, Rare Candy, and gadget.',
      },
      {
        id: 'stadium',
        label: 'Stadiums',
        blurb: 'The places — gyms, towers, and wild areas.',
      },
      {
        id: 'tool',
        label: 'Pokémon Tools',
        blurb: 'Attachments your Pokémon carry.',
      },
      {
        id: 'technical-machine',
        label: 'Technical Machines',
        blurb: 'The vintage TMs and their modern returns.',
      },
    ],
  },
  {
    label: 'Energy',
    classes: [
      {
        id: 'special-energy',
        label: 'Special Energy',
        blurb: 'Energy with a twist, from Double Colorless on.',
      },
      {
        id: 'basic-energy',
        label: 'Basic Energy',
        blurb: 'Holo promos and set-stamped basics.',
      },
    ],
  },
  {
    label: 'Vintage & special mechanics',
    classes: [
      {
        id: 'ace-spec',
        label: 'ACE SPEC',
        blurb: 'One per deck, loud pink frames.',
      },
      {
        id: 'prism-star',
        label: 'Prism Star',
        blurb: 'The black-frame ♢ cards from Sun & Moon.',
      },
      {
        id: 'radiant',
        label: 'Radiant',
        blurb: 'Shiny K-arts from Sword & Shield.',
      },
      {
        id: 'break',
        label: 'BREAK',
        blurb: 'The sideways gold evolutions from XY.',
      },
      {
        id: 'legend',
        label: 'LEGEND',
        blurb: 'Two-card halves from HeartGold & SoulSilver.',
      },
    ],
  },
]

/** Flat id → entry lookup for the classes above. */
export const CARD_CLASSES_BY_ID = new Map(
  CARD_CLASS_GROUPS.flatMap((g) => g.classes).map((c) => [c.id, c]),
)
