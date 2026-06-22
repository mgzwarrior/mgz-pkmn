/**
 * FavoritePokemonOnboarding — the first-login pop-up survey that asks a new
 * user which Pokémon they love, seeding the favorite-species signal that
 * Swipe / Browse lean toward (#742, epic #701).
 *
 * Shows once per account: the gate is the server-side
 * `onboarding_completed_at` exposed as `user.onboardingCompleted`. Both
 * "Done" and "Skip" mark onboarding complete (via the parent's `onClose`), so
 * the pop-up never re-nags — picks are saved live through
 * {@link useFavoritePokemon}, so there's nothing to "submit".
 *
 * Picking is the same as the inline pokedex tiles: a curated quick-pick row of
 * crowd favorites for a one-tap start, plus a search over the baked Pokédex.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { ImageOff, Search, Star, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { pokemonSpriteUrl } from '../api/client'
import { BAKED_POKEDEX } from '../data/pokedex'
import type { PokedexEntry } from '../types'
import { useFavoritePokemon } from './useFavoritePokemon'

/** Crowd favorites — a one-tap start so the survey is never a blank search. */
const QUICK_PICK_NUMBERS = [25, 6, 150, 133, 94, 448, 658, 384, 282, 445, 143, 149]

/** How many search matches to render — enough to find a species, short of a
 *  scroll marathon. */
const MAX_RESULTS = 24

const DEX_BY_NUMBER = new Map(BAKED_POKEDEX.map((e) => [e.number, e]))

const QUICK_PICKS: PokedexEntry[] = QUICK_PICK_NUMBERS.map((n) => DEX_BY_NUMBER.get(n)).filter(
  (e): e is PokedexEntry => e !== undefined,
)

function matches(entry: PokedexEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return entry.name.toLowerCase().includes(q) || String(entry.number) === q
}

interface Props {
  open: boolean
  onClose: () => void
}

export function FavoritePokemonOnboarding({ open, onClose }: Props) {
  const { favorites, isFavorite, pin, unpin } = useFavoritePokemon({ enabled: open })
  const [query, setQuery] = useState('')

  const results = useMemo<PokedexEntry[]>(() => {
    if (query.trim() === '') return []
    return BAKED_POKEDEX.filter((e) => matches(e, query)).slice(0, MAX_RESULTS)
  }, [query])

  const toggle = (number: number) =>
    isFavorite(number) ? void unpin(number) : void pin(number)

  const list = query.trim() === '' ? QUICK_PICKS : results
  const pickedCount = favorites.length

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200">
          <header className="flex items-start justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
                Pick your favorite Pokémon
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-coconut-400 dark:text-sand-300">
                Tap a few you love and we’ll lean Swipe and Browse toward them. You can
                always change these later.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded p-1 text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
              >
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </header>

          <div className="border-b border-sand-200 px-5 py-3 dark:border-husk-100">
            <label className="relative block">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-coconut-400 dark:text-sand-400"
                aria-hidden
              />
              <input
                type="search"
                placeholder="Search for a Pokémon by name or dex #…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-md border border-sand-300 bg-sand-50 py-1.5 pl-8 pr-2 text-sm text-coconut-700 placeholder:text-coconut-400 focus:border-sand-400 focus:outline-none dark:border-husk-50 dark:bg-husk-400 dark:text-sand-50 dark:placeholder:text-sand-400 dark:focus:border-coconut-400"
                aria-label="Search for a Pokémon"
              />
            </label>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-coconut-600 dark:text-sand-200">
              {query.trim() === '' ? 'Crowd favorites' : `Results for “${query.trim()}”`}
            </p>
            {list.length === 0 ? (
              <p className="text-sm text-coconut-400 dark:text-sand-400">
                No Pokémon match “{query.trim()}”.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {list.map((entry) => (
                  <OnboardingSpeciesTile
                    key={entry.number}
                    species={entry}
                    favorited={isFavorite(entry.number)}
                    onToggle={() => toggle(entry.number)}
                  />
                ))}
              </ul>
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-sand-200 px-5 py-3 dark:border-husk-100">
            <span className="text-xs text-coconut-400 dark:text-sand-300" role="status">
              {pickedCount === 0
                ? 'Nothing picked yet'
                : `${pickedCount} favorite${pickedCount === 1 ? '' : 's'} picked`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-palm-500 px-3 py-1.5 text-sm font-medium text-sand-50 hover:bg-palm-600 dark:bg-palm-400 dark:text-husk-500 dark:hover:bg-palm-300"
              >
                Done
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function OnboardingSpeciesTile({
  species,
  favorited,
  onToggle,
}: {
  species: PokedexEntry
  favorited: boolean
  onToggle: () => void
}) {
  const [spriteFailed, setSpriteFailed] = useState(false)
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={favorited}
        aria-label={
          favorited
            ? `Remove ${species.name} from favorites`
            : `Add ${species.name} to favorites`
        }
        className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50 ${
          favorited
            ? 'border-sun-400 bg-sun-400/15 dark:border-sun-300 dark:bg-sun-300/20'
            : 'border-sand-200 bg-sand-50 hover:border-sand-300 hover:bg-sand-50 dark:border-husk-100 dark:bg-husk-400/40 dark:hover:border-husk-50 dark:hover:bg-husk-200'
        }`}
      >
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded bg-sand-50 dark:bg-husk-400">
          {spriteFailed ? (
            <ImageOff size={14} className="text-coconut-300 dark:text-sand-500" aria-hidden />
          ) : (
            <img
              src={pokemonSpriteUrl(species.number)}
              alt=""
              className="h-9 w-9 object-contain"
              loading="lazy"
              onError={() => setSpriteFailed(true)}
            />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-coconut-700 dark:text-sand-50">
          {species.name}
        </span>
        <Star
          size={16}
          className={
            favorited
              ? 'flex-none fill-sun-400 text-sun-500 dark:fill-sun-300 dark:text-sun-300'
              : 'flex-none text-coconut-300 dark:text-sand-500'
          }
          aria-hidden
        />
      </button>
    </li>
  )
}
