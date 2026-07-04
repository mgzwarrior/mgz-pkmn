/**
 * Which configurable-export fields (#262) each format supports, plus their
 * display labels and the all-enabled default. Single source of truth for
 * both the Zustand store's default `Settings.exportFields` and the
 * SettingsDrawer's "Export columns" section, so the two can't drift apart
 * on which format supports which field.
 *
 * Mirrors `mgz_pkmn.export_fields` on the backend — the binder PDF (`pdf` /
 * `condensed-pdf`) doesn't render rarity, variant, price source, or the
 * source URL at all today, so those aren't offered for it here either.
 */
import type { ExportField, ExportFieldToggles, ExportFormat } from '../types'

export const EXPORT_FIELD_LABELS: Record<ExportField, string> = {
  thumbnail: 'Thumbnail image',
  name: 'Name',
  set: 'Set',
  number: 'Number',
  rarity: 'Rarity',
  variant: 'Variant',
  market: 'Market price',
  comp_80: '80% comp',
  comp_85: '85% comp',
  comp_90: '90% comp',
  comp_95: '95% comp',
  source: 'Price source',
  source_url: 'Source URL',
}

const XLSX_FIELDS: ExportField[] = [
  'thumbnail', 'name', 'set', 'number', 'rarity', 'variant',
  'market', 'comp_80', 'comp_85', 'comp_90', 'comp_95', 'source', 'source_url',
]
const BINDER_FIELDS: ExportField[] = [
  'thumbnail', 'name', 'set', 'number', 'market', 'comp_80', 'comp_85', 'comp_90', 'comp_95',
]
const CHECKLIST_FIELDS: ExportField[] = ['name', 'set', 'number', 'rarity', 'market']

export const EXPORT_FIELD_OPTIONS: Record<ExportFormat, ExportField[]> = {
  xlsx: XLSX_FIELDS,
  pdf: BINDER_FIELDS,
  'condensed-pdf': BINDER_FIELDS,
  checklist: CHECKLIST_FIELDS,
}

function allEnabled(fields: ExportField[]): Partial<Record<ExportField, boolean>> {
  return Object.fromEntries(fields.map((f) => [f, true]))
}

export const DEFAULT_EXPORT_FIELDS: ExportFieldToggles = {
  xlsx: allEnabled(XLSX_FIELDS),
  pdf: allEnabled(BINDER_FIELDS),
  'condensed-pdf': allEnabled(BINDER_FIELDS),
  checklist: allEnabled(CHECKLIST_FIELDS),
}

/** The list of field keys enabled (truthy) in a format's toggle record —
 *  what gets sent as `fields` on the export request. */
export function enabledFields(toggles: Partial<Record<ExportField, boolean>>): ExportField[] {
  return (Object.keys(toggles) as ExportField[]).filter((key) => toggles[key])
}
