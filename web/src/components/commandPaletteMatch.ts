/**
 * commandPaletteMatch — pure helpers for [CommandPalette](./CommandPalette.tsx)
 * (#525): an ordered-subsequence fuzzy scorer (hand-rolled rather than a new
 * dependency, matching the project's existing Radix-primitive-plus-Tailwind
 * convention) and the localStorage-backed "recent commands" list that
 * surfaces recent picks ahead of the rest when the query is empty.
 */

const RECENT_COMMANDS_KEY = 'mgz-pkmn:recent-commands'
export const RECENT_COMMANDS_LIMIT = 5

/**
 * Score `label` against `query` as an ordered subsequence match — every
 * character of `query` must appear in `label`, in order, case-insensitively.
 * Returns `null` when it doesn't match at all. Higher scores are better:
 * consecutive and early matches score higher, so typing "sw" ranks "Switch
 * mode: Swipe" above a coincidental scattered match elsewhere in the list.
 */
export function fuzzyScore(query: string, label: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const text = label.toLowerCase()
  let qi = 0
  let score = 0
  let lastMatchIndex = -1
  for (let ti = 0; ti < text.length && qi < q.length; ti++) {
    if (text[ti] !== q[qi]) continue
    score += lastMatchIndex === ti - 1 ? 3 : 1
    lastMatchIndex = ti
    qi++
  }
  if (qi < q.length) return null
  // Earlier matches (lower lastMatchIndex) edge out later ones on a tie.
  return score - lastMatchIndex * 0.01
}

function readLocalStorage(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_COMMANDS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Read the recent-command-id list, most-recently-invoked first. */
export function readRecentCommandIds(): string[] {
  return readLocalStorage()
}

/** Record `id` as just-invoked, moving it to the front and capping the list. */
export function recordRecentCommandId(id: string): string[] {
  const next = [id, ...readLocalStorage().filter((x) => x !== id)].slice(0, RECENT_COMMANDS_LIMIT)
  try {
    window.localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next))
  } catch {
    // ignore — losing recency ordering across reloads is a fine fallback
  }
  return next
}
