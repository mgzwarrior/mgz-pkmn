/**
 * Shared binder-identity constants (#679) — kept in their own module so the
 * modal and the library list can both pull from one source, and so neither
 * component file mixes non-component exports (react-refresh).
 *
 * `BINDER_COLOR_OPTIONS` mirrors the server's `BINDER_COLORS` allowlist;
 * keep the two in sync.
 */
import type { BinderColor, BinderFormat } from '../api/client'

export const BINDER_COLOR_OPTIONS: { value: BinderColor; label: string }[] = [
  { value: 'palm', label: 'Palm' },
  { value: 'sun', label: 'Sun' },
  { value: 'sky', label: 'Sky' },
  { value: 'ember', label: 'Ember' },
  { value: 'coconut', label: 'Coconut' },
  { value: 'sand', label: 'Sand' },
]

export const BINDER_FORMAT_OPTIONS: { value: BinderFormat; label: string }[] = [
  { value: '4-pocket', label: '4-pocket' },
  { value: '9-pocket', label: '9-pocket' },
  { value: '12-pocket', label: '12-pocket' },
]

/** Tailwind swatch class per color. Spelled out so the JIT keeps them. */
export const SWATCH_BG: Record<BinderColor, string> = {
  palm: 'bg-palm-500',
  sun: 'bg-sun-400',
  sky: 'bg-sky-500',
  ember: 'bg-ember-500',
  coconut: 'bg-coconut-500',
  sand: 'bg-sand-400',
}
