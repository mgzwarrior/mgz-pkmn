/**
 * cardCategories — collector-meaningful archetypes derived from the fields
 * every card surface already carries (name, rarity, subtypes, id). These cut
 * across rarity and subtype the way collectors actually talk about chase
 * cards: "all the Tag Team cards", "every Gym Leader's Pokémon", "the
 * connecting-scene illustrations" (#700).
 *
 * Derivation is intentionally client-side and pure, mirroring the existing
 * rarity-bucket derivation in [useBrowseController](./useBrowseController.ts).
 * That keeps a single source of truth that works uniformly across Browse
 * (`SetCard`) and the detail modal (`CardData`) without a payload change or
 * a migration — every input field is present on both shapes.
 *
 * Three of the four categories fall out of name/subtype/rarity heuristics.
 * The fourth — connecting scene — isn't in any field, so it rides a small
 * curated seed of pokemontcg.io card ids (see CONNECTING_SCENE_IDS),
 * sourced from Bulbapedia and meant to grow over time.
 */

/** The archetypes a card can belong to. A card can carry several at once
 *  (e.g. a Gym Leader's Pokémon is also an owner's Pokémon). */
export type CardCategory =
  | 'tag-team'
  | 'owner'
  | 'gym-leader'
  | 'illustration-rare'
  | 'connecting-scene'

/** Short, UI-ready label for each category. */
export const CATEGORY_LABELS: Record<CardCategory, string> = {
  'tag-team': 'Tag Team',
  owner: "Trainer's Pokémon",
  'gym-leader': "Gym Leader's Pokémon",
  'illustration-rare': 'Illustration rare',
  'connecting-scene': 'Connecting scene',
}

/** Display order — most specific / highest-signal first. */
export const CATEGORY_ORDER: CardCategory[] = [
  'connecting-scene',
  'gym-leader',
  'owner',
  'tag-team',
  'illustration-rare',
]

/**
 * Reference reading for the art-driven archetypes. Surfaced as "learn more"
 * links so a collector can see the full, canonical list behind the badge.
 */
export const CATEGORY_REFERENCES: Partial<Record<CardCategory, { label: string; url: string }>> = {
  'connecting-scene': {
    label: 'Combined illustrations (Bulbapedia)',
    url: 'https://bulbapedia.bulbagarden.net/wiki/Combined_illustration_(TCG)',
  },
}

/** The minimal card shape every surface can supply. */
export interface CategorizableCard {
  id?: string | null
  name?: string | null
  rarity?: string | null
  supertype?: string | null
  subtypes?: string[] | null
}

/** Gym Leaders (and the Rocket boss) whose "<name>'s <Pokémon>" cards are
 *  the canonical Gym Leader's Pokémon archetype. Kanto + Johto, matching the
 *  Gym Heroes / Gym Challenge era these cards are best known from. Lowercase
 *  for case-insensitive matching against the possessive prefix. */
const GYM_LEADERS = new Set([
  // Kanto
  'brock',
  'misty',
  'lt. surge',
  'erika',
  'koga',
  'sabrina',
  'blaine',
  'giovanni',
  // Johto
  'falkner',
  'bugsy',
  'whitney',
  'morty',
  'chuck',
  'jasmine',
  'pryce',
  'clair',
])

/** Matches a "<Owner>'s <Pokémon>" possessive prefix. `[^']+` keeps the owner
 *  apostrophe-free so a name like "Farfetch'd" (an apostrophe-d, not -s) is
 *  not mistaken for an owner card. */
const OWNER_RE = /^([^']+)'s\s/

/** The possessive owner name, lowercased, or null when the card isn't an
 *  owner's Pokémon. */
function ownerName(name: string): string | null {
  const m = OWNER_RE.exec(name)
  return m ? m[1].trim().toLowerCase() : null
}

/**
 * Curated seed of connecting-scene (combined-illustration) cards, keyed by
 * pokemontcg.io card id (`<setId>-<number>`). Sourced from Bulbapedia's
 * combined-illustration list; scoped to the modern sets a Browse user is
 * most likely to walk (Scarlet & Violet era plus the highest-signal Sword &
 * Shield / XY / SM groups). Extend freely as coverage grows — a wrong id
 * simply never matches a card, so the seed degrades safely.
 *
 * @see https://bulbapedia.bulbagarden.net/wiki/Combined_illustration_(TCG)
 */
export const CONNECTING_SCENE_IDS: ReadonlySet<string> = new Set([
  // --- Sword & Shield era ---
  // Celebrations — legendary duo / trio reprints
  'cel25-1', // Ho-Oh
  'cel25-22', // Lugia
  'cel25-2', // Reshiram
  'cel25-10', // Zekrom
  'cel25-16', // Zacian V
  'cel25-18', // Zamazenta V
  // Battle Styles — the two Urshifu VMAX
  'swsh5-86', // Single Strike Urshifu VMAX
  'swsh5-88', // Rapid Strike Urshifu VMAX
  // Chilling Reign — Seviper / Zangoose
  'swsh6-102', // Seviper
  'swsh6-120', // Zangoose
  // Shining Fates — Eevee (paired with a promo Vaporeon)
  'swsh45-52', // Eevee
  // Crown Zenith — Eevee V
  'swsh12pt5-108', // Eevee V
  // Crown Zenith Galarian Gallery — the nine-card baby-Pokémon scene
  'swsh12pt5gg-GG26', // Riolu
  'swsh12pt5gg-GG27', // Swablu
  'swsh12pt5gg-GG28', // Duskull
  'swsh12pt5gg-GG29', // Bidoof
  'swsh12pt5gg-GG30', // Pikachu
  'swsh12pt5gg-GG31', // Turtwig
  'swsh12pt5gg-GG32', // Paras
  'swsh12pt5gg-GG33', // Poochyena
  'swsh12pt5gg-GG34', // Mareep
  // Crown Zenith Galarian Gallery — the four creation-trio + Arceus VSTAR
  'swsh12pt5gg-GG67', // Origin Forme Palkia VSTAR
  'swsh12pt5gg-GG68', // Origin Forme Dialga VSTAR
  'swsh12pt5gg-GG69', // Giratina VSTAR
  'swsh12pt5gg-GG70', // Arceus VSTAR

  // --- Scarlet & Violet era ---
  // Scarlet & Violet base — Spidops/Tarountula + the cross-set Skwovet scene
  'sv1-243', // Spidops ex
  'sv1-199', // Tarountula
  'sv1-151', // Skwovet (nine-card scene across SV / PAL / OBF / PAR / PAF)
  // Paldea Evolved — Magikarp / Palossand (cross-set scene members)
  'sv2-42', // Magikarp
  'sv2-96', // Palossand
  // Obsidian Flames — Combee / Lechonk (cross-set scene members)
  'sv3-8', // Combee
  'sv3-180', // Lechonk
  // Paradox Rift
  'sv4-203', // Slither Wing
  'sv4-187', // Iron Moth
  'sv4-193', // Plusle
  'sv4-194', // Minun
  'sv4-252', // Gholdengo ex
  'sv4-198', // Gimmighoul
  'sv4-152', // Swablu (cross-set scene member)
  'sv4-91', // Gligar (cross-set scene member)
  'sv4-30', // Horsea (cross-set scene member)
  // Paldean Fates — Mime Jr. (cross-set scene member)
  'sv4pt5-31', // Mime Jr.
  // Temporal Forces
  'sv5-16', // Deerling
  'sv5-17', // Sawsbuck
  'sv5-129', // Dudunsparce (cross-set scene member)
  // Twilight Masquerade
  'sv6-9', // Volbeat
  'sv6-10', // Illumise
  'sv6-220', // Perrin
  'sv6-181', // Hisuian Growlithe
  'sv6-75', // Wattrel (cross-set scene member)
  'sv6-30', // Torkoal (cross-set scene member)
  // Shrouded Fable — Golbat (cross-set scene member)
  'sv6pt5-28', // Golbat
  // Stellar Crown — Slowpoke (cross-set scene member)
  'sv7-57', // Slowpoke
  // Surging Sparks
  'sv8-203', // Latios
  'sv8-239', // Latias ex
  'sv8-105', // Vibrava (cross-set scene member)
  'sv8-71', // Togetic (cross-set scene member)
  'sv8-111', // Passimian (cross-set scene member)
  'sv8-43', // Spheal (cross-set scene member)

  // --- XY / SM era — the recurring Plusle/Minun + Volbeat/Illumise pairs ---
  'xy3-31', // Plusle (Furious Fists)
  'xy3-32', // Minun (Furious Fists)
  'xy5-17', // Volbeat (Primal Clash)
  'xy5-18', // Illumise (Primal Clash)
  'sm7-17', // Volbeat (Celestial Storm)
  'sm7-18', // Illumise (Celestial Storm)
])

/**
 * Derive the archetypes a card belongs to, in {@link CATEGORY_ORDER}.
 * Pure and cheap — safe to call per-card in a render or filter pass.
 */
export function cardCategories(card: CategorizableCard): CardCategory[] {
  const out: CardCategory[] = []
  const name = card.name ?? ''
  const rarity = (card.rarity ?? '').toLowerCase()
  const subtypes = (card.subtypes ?? []).map((s) => s.toLowerCase())

  if (card.id && CONNECTING_SCENE_IDS.has(card.id)) out.push('connecting-scene')

  // Owner / Gym Leader cards are a Pokémon archetype — gate on the supertype
  // so possessive-named Trainer cards (e.g. "Misty's Determination",
  // "Brock's Grit") aren't mislabeled as a Trainer's Pokémon.
  if ((card.supertype ?? '').toLowerCase() === 'pokémon') {
    const owner = ownerName(name)
    if (owner) {
      if (GYM_LEADERS.has(owner)) out.push('gym-leader')
      out.push('owner')
    }
  }

  if (subtypes.includes('tag team')) out.push('tag-team')

  if (
    rarity.includes('illustration rare') ||
    rarity.includes('character rare') ||
    rarity.includes('character super rare')
  ) {
    out.push('illustration-rare')
  }

  return out
}

/** Whether a card belongs to a given category. */
export function inCategory(card: CategorizableCard, category: CardCategory): boolean {
  return cardCategories(card).includes(category)
}
