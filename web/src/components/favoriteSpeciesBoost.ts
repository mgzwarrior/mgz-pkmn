/**
 * favoriteSpeciesBoost — the extra swipe candidate-draw weight a card earns
 * when it prints a favorite Pokémon (#742, epic #701).
 *
 * The species-level sibling of the pinned-favorite-set bonus: folded into the
 * swipe `cardScore` on top of the learned taste profile so the deck leans
 * toward the Pokémon a user explicitly loves, without ever collapsing the feed
 * onto one species (the bounded `profileMultiplier` in `useSwipeCandidates`
 * clamps it).
 */
import type { SetCard } from '../types'

/** Profile-score bonus a card of a favorite Pokémon adds to its in-set draw
 *  weight. Sized like the pinned-favorite-set bonus so an explicit "I love
 *  this Pokémon" lands the card near the multiplier cap. */
export const FAVORITE_SPECIES_BONUS = 12

/**
 * {@link FAVORITE_SPECIES_BONUS} when any of the card's national dex numbers is
 * favorited, else 0.
 */
export function favoriteSpeciesBoost(
  card: Pick<SetCard, 'dexNumbers'>,
  isFavorite: (dexNumber: number) => boolean,
): number {
  return card.dexNumbers?.some(isFavorite) ? FAVORITE_SPECIES_BONUS : 0
}
