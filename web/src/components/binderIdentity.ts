/**
 * Shared binder-identity constants (#679) — kept in their own module so the
 * modal and the library list can both pull from one source, and so neither
 * component file mixes non-component exports (react-refresh).
 *
 * `BINDER_COLOR_OPTIONS` mirrors the server's `BINDER_COLORS` allowlist;
 * keep the two in sync.
 */
import type { BinderColor, BinderFormat, BinderType } from '../api/client'

export const BINDER_COLOR_OPTIONS: { value: BinderColor; label: string }[] = [
  { value: 'palm', label: 'Palm' },
  { value: 'sun', label: 'Sun' },
  { value: 'sky', label: 'Sky' },
  { value: 'ember', label: 'Ember' },
  { value: 'coconut', label: 'Coconut' },
  { value: 'sand', label: 'Sand' },
  { value: 'husk', label: 'Husk' },
]

export const BINDER_FORMAT_OPTIONS: { value: BinderFormat; label: string }[] = [
  { value: '4-pocket', label: '4-pocket' },
  { value: '9-pocket', label: '9-pocket' },
  { value: '12-pocket', label: '12-pocket' },
]

/** Storage style (#681). Sentence-case labels per the design voice. */
export const BINDER_TYPE_OPTIONS: { value: BinderType; label: string }[] = [
  { value: 'regular', label: 'Binder pages' },
  { value: 'toploader', label: 'Toploaders' },
  { value: 'graded', label: 'Graded slabs' },
  { value: 'other', label: 'Other' },
]

/** Tailwind swatch class per preset color. Spelled out so the JIT keeps them. */
export const SWATCH_BG: Record<BinderColor, string> = {
  palm: 'bg-palm-500',
  sun: 'bg-sun-400',
  sky: 'bg-sky-500',
  ember: 'bg-ember-500',
  coconut: 'bg-coconut-500',
  sand: 'bg-sand-400',
  husk: 'bg-husk-400',
}

/** A stored `binder_color` is either a preset token stem (rendered via the
 * Tailwind class) or a user-chosen `#rrggbb` hex (rendered inline, #681).
 * Returns the className/style pair to apply to a swatch element. */
export function coverSwatch(
  color: string | null | undefined,
): { className: string; style?: { backgroundColor: string } } {
  if (!color) return { className: 'bg-sand-200 dark:bg-husk-100' }
  if (color.startsWith('#')) return { className: '', style: { backgroundColor: color } }
  const preset = SWATCH_BG[color as BinderColor]
  return { className: preset ?? 'bg-sand-200 dark:bg-husk-100' }
}
