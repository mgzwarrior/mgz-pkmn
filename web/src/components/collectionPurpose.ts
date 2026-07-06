/**
 * Shared collection-purpose constants (#707) — kept in their own module so
 * the create dialog and the library list can both pull from one source
 * without mixing non-component exports into a component file (react-refresh).
 *
 * `PURPOSE_OPTIONS` mirrors the server's `COLLECTION_PURPOSES` allowlist;
 * keep the two in sync. Sentence-case labels per the design voice.
 */
import type { CollectionPurpose } from '../api/client'

export const PURPOSE_OPTIONS: { value: CollectionPurpose; label: string }[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'trade', label: 'Trade' },
  { value: 'bulk', label: 'Bulk' },
]

export const PURPOSE_LABELS: Record<CollectionPurpose, string> = Object.fromEntries(
  PURPOSE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<CollectionPurpose, string>
