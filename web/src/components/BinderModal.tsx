/**
 * BinderModal — the single create-and-edit surface for binders (#679, #681).
 *
 * Everything in the Binders tab is a binder: a **physical binder** (a bucket
 * of cards with a cover, storage style, pocket format, and capacity) or a
 * **smart binder** (a saved rule whose membership is your matching cards).
 * The two share cover/storage-type/master-set identity; pocket format and
 * capacity are physical-only, since a rule-based set has no fixed slots.
 *
 * - **Novice path:** name it, pick a cover color, done. The rest is tucked
 *   behind a "More details" disclosure so the simple case stays one decision.
 * - **Vendor path:** open the details to set storage type, pocket format,
 *   capacity, the set it organizes, and a master-set target.
 *
 * Create writes a `kind='binder'` (or `kind='dynamic'`) collection; edit
 * PATCHes an existing binder's identity. Both go through
 * [useCollections](./useCollections.ts) so every surface re-renders without
 * a refetch.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, Loader2, Sparkles, Wallet, X } from 'lucide-react'
import { useState } from 'react'
import type {
  BinderFormat,
  BinderType,
  CollectionRule,
  CollectionSummary,
  DynamicScope,
} from '../api/client'
import {
  BINDER_COLOR_OPTIONS,
  BINDER_FORMAT_OPTIONS,
  BINDER_TYPE_OPTIONS,
  SWATCH_BG,
} from './binderIdentity'
import { useCollections } from './useCollections'

/** The single-predicate fields the smart-binder rule builder offers. */
const RULE_FIELDS = [
  { key: 'name', label: 'Name contains' },
  { key: 'types', label: 'Type is' },
  { key: 'set_id', label: 'Set is' },
  { key: 'rarity', label: 'Rarity is' },
  { key: 'number', label: 'Number is' },
] as const

type RuleField = (typeof RULE_FIELDS)[number]['key']

const SCOPE_OPTIONS: { key: DynamicScope; label: string }[] = [
  { key: 'owned', label: 'My cards' },
  { key: 'catalog', label: 'Whole catalog' },
]

/** Which flavor of binder the create form is building. */
type BinderMode = 'binder' | 'smart'

//: Cardrake's master-set guide — credited source for the explainer (#681).
const CARDRAKE_MASTER_SET_URL = 'https://www.cardrake.com/guides/master-set'

//: Seed value for the native color picker before a hex is chosen — a neutral
//: gray, not a brand color, so it stays clear of the no-hex theme rule.
const CUSTOM_COLOR_SEED = '#8a8a8a'

function buildRule(field: RuleField, value: string): CollectionRule {
  const v = value.trim()
  return field === 'types' ? { types: [v] } : { [field]: v }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, edit this binder's identity; otherwise create a new one. */
  editing?: CollectionSummary | null
}

export function BinderModal({ open, onOpenChange, editing }: Props) {
  const { create, update } = useCollections()
  const isEdit = editing != null
  // A dynamic collection edits as a smart binder; everything else as physical.
  const editMode: BinderMode = editing?.kind === 'dynamic' ? 'smart' : 'binder'

  // State is seeded once at mount from the binder being edited (or blank for
  // a create). The parent remounts this modal with a fresh `key` on each
  // open, so these lazy initializers stand in for a reset-on-open effect.
  const [mode, setMode] = useState<BinderMode>(editMode)
  const [name, setName] = useState(() => editing?.name ?? '')
  const [color, setColor] = useState<string | null>(
    () => editing?.binder_color ?? (editing ? null : 'palm'),
  )
  const [binderType, setBinderType] = useState<BinderType | ''>(() => editing?.binder_type ?? '')
  const [format, setFormat] = useState<BinderFormat | ''>(() => editing?.binder_format ?? '')
  const [capacity, setCapacity] = useState(() =>
    editing?.capacity != null ? String(editing.capacity) : '',
  )
  const [sourceSetId, setSourceSetId] = useState(() => editing?.source_set_id ?? '')
  const [isMasterSet, setIsMasterSet] = useState(() => Boolean(editing?.is_master_set))
  const [detailsOpen, setDetailsOpen] = useState(() =>
    Boolean(
      editing?.binder_format ||
        editing?.capacity ||
        editing?.source_set_id ||
        editing?.binder_type ||
        editing?.is_master_set,
    ),
  )
  // Smart-binder rule state.
  const [field, setField] = useState<RuleField>('name')
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<DynamicScope>('owned')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSmart = mode === 'smart'
  // The rule is only authored on create — editing a smart binder touches just
  // its identity (name/color/type/master-set), so the rule value isn't
  // required (and the rule editor is hidden) in edit mode.
  const editingRule = isSmart && !isEdit
  const canSubmit = name.trim().length > 0 && (!editingRule || value.trim().length > 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const cap = capacity.trim() ? Number(capacity.trim()) : null
    // Shared identity rides both kinds; physical fields ride binders only.
    const shared = {
      binder_color: color,
      binder_type: binderType || null,
    }
    try {
      if (isEdit && editing) {
        await update(editing.id, {
          name: name.trim(),
          ...shared,
          ...(editMode === 'binder'
            ? {
                binder_format: format || null,
                capacity: cap,
                ...(editing.source_set_id ? { is_master_set: isMasterSet } : {}),
              }
            : { is_master_set: isMasterSet }),
        })
      } else if (isSmart) {
        await create(name.trim(), {
          kind: 'dynamic',
          rule: buildRule(field, value),
          dynamic_scope: scope,
          ...shared,
          is_master_set: isMasterSet,
        })
      } else {
        const set = sourceSetId.trim()
        await create(name.trim(), {
          kind: 'binder',
          ...shared,
          binder_format: format || null,
          capacity: cap,
          source_set_id: set || null,
          is_master_set: set ? isMasterSet : false,
        })
      }
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded border border-sand-300 bg-coconut-50 px-2.5 py-1.5 text-sm text-coconut-700 placeholder:text-coconut-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-100 dark:bg-husk-100 dark:text-sand-50 dark:focus:ring-sun-300'
  const customActive = Boolean(color?.startsWith('#'))

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(460px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200">
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
              {isEdit ? 'Edit binder' : 'New binder'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-1 text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            Name your binder, pick a cover color, and optionally set its storage
            type, pocket format, capacity, and the set it organizes.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Mode — physical vs. smart binder. Hidden when editing, since a
                binder's kind is fixed. */}
            {!isEdit && (
              <div role="radiogroup" aria-label="Binder type" className="grid grid-cols-2 gap-2">
                <TypeCard
                  active={mode === 'binder'}
                  onClick={() => setMode('binder')}
                  icon={<Wallet size={15} />}
                  title="Binder"
                  blurb="Cards you keep, with a cover and shelf identity."
                />
                <TypeCard
                  active={mode === 'smart'}
                  onClick={() => setMode('smart')}
                  icon={<Sparkles size={15} />}
                  title="Smart binder"
                  blurb="A saved rule over the cards you already own."
                />
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
                Name
              </span>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isSmart ? 'All Eevees' : 'Trade binder'}
                className={inputClass}
              />
            </label>

            {/* Cover color — shared identity, presets + a custom hex picker. */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
                Cover color
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {BINDER_COLOR_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-label={opt.label}
                    aria-pressed={color === opt.value}
                    title={opt.label}
                    onClick={() => setColor(color === opt.value ? null : opt.value)}
                    className={`h-7 w-7 rounded-full ${SWATCH_BG[opt.value]} ring-offset-1 ring-offset-sand-50 transition dark:ring-offset-husk-200 ${
                      color === opt.value
                        ? 'ring-2 ring-coconut-600 dark:ring-sand-50'
                        : 'ring-1 ring-sand-300 dark:ring-husk-100'
                    }`}
                  />
                ))}
                {/* Custom hex — a native color input styled as a swatch. */}
                <label
                  title="Custom color"
                  className={`relative h-7 w-7 cursor-pointer overflow-hidden rounded-full ring-offset-1 ring-offset-sand-50 transition dark:ring-offset-husk-200 ${
                    customActive
                      ? 'ring-2 ring-coconut-600 dark:ring-sand-50'
                      : 'ring-1 ring-sand-300 dark:ring-husk-100'
                  }`}
                  style={customActive && color ? { backgroundColor: color } : undefined}
                >
                  {!customActive && (
                    <span className="absolute inset-0 bg-[conic-gradient(red,orange,yellow,lime,aqua,blue,magenta,red)] opacity-70" />
                  )}
                  <input
                    type="color"
                    aria-label="Custom cover color"
                    value={customActive && color ? color : CUSTOM_COLOR_SEED}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </div>

            {editingRule && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <select
                    value={field}
                    onChange={(e) => setField(e.target.value as RuleField)}
                    className="shrink-0 rounded border border-sand-300 bg-coconut-50 px-2 py-1.5 text-sm text-coconut-700 dark:border-husk-100 dark:bg-husk-100 dark:text-sand-50"
                  >
                    {RULE_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={field === 'types' ? 'Fire' : 'Eevee'}
                    className={`min-w-0 flex-1 ${inputClass}`}
                  />
                </div>
                <div>
                  <div
                    role="radiogroup"
                    aria-label="Membership scope"
                    className="inline-flex rounded border border-sand-300 p-0.5 dark:border-husk-100"
                  >
                    {SCOPE_OPTIONS.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        role="radio"
                        aria-checked={scope === s.key}
                        onClick={() => setScope(s.key)}
                        className={`rounded px-2.5 py-1 text-[11px] font-medium ${
                          scope === s.key
                            ? 'bg-palm-500 text-coconut-50 dark:text-husk-300'
                            : 'text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-coconut-400 dark:text-sand-300">
                    {scope === 'owned'
                      ? 'Filters the cards you already own.'
                      : 'Pulls every match from the catalog and tracks your progress.'}
                  </p>
                </div>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setDetailsOpen((o) => !o)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-palm-600 hover:text-palm-700 dark:text-palm-300"
              >
                <ChevronDown
                  size={13}
                  className={`transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
                />
                More details
              </button>

              {detailsOpen && (
                <div className="mt-3 space-y-3 rounded-md border border-sand-200 bg-coconut-50 p-3 dark:border-husk-100 dark:bg-husk-100">
                  {/* Storage type — shared identity. */}
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-coconut-500 dark:text-sand-300">
                      Storage type
                    </span>
                    <select
                      value={binderType}
                      onChange={(e) => setBinderType(e.target.value as BinderType | '')}
                      className={inputClass}
                    >
                      <option value="">Not set</option>
                      {BINDER_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* Pocket format + capacity — physical binders only. */}
                  {!isSmart && (
                    <>
                      <div className="flex gap-2">
                        <label className="flex-1 space-y-1">
                          <span className="text-[11px] font-medium text-coconut-500 dark:text-sand-300">
                            Pocket format
                          </span>
                          <select
                            value={format}
                            onChange={(e) => setFormat(e.target.value as BinderFormat | '')}
                            className={inputClass}
                          >
                            <option value="">Not set</option>
                            {BINDER_FORMAT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="w-28 space-y-1">
                          <span className="text-[11px] font-medium text-coconut-500 dark:text-sand-300">
                            Capacity
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={capacity}
                            onChange={(e) => setCapacity(e.target.value)}
                            placeholder="360"
                            className={inputClass}
                          />
                        </label>
                      </div>

                      {/* Set anchor is create-only — a binder's set can't be
                          re-pointed after the fact. */}
                      {!isEdit && (
                        <label className="block space-y-1">
                          <span className="text-[11px] font-medium text-coconut-500 dark:text-sand-300">
                            Organizes a set (optional)
                          </span>
                          <input
                            type="text"
                            value={sourceSetId}
                            onChange={(e) => setSourceSetId(e.target.value)}
                            placeholder="Set ID, e.g. sv1"
                            className={inputClass}
                          />
                        </label>
                      )}
                    </>
                  )}

                  {/* Master-set target — shared. A physical binder needs a set
                      anchor; a smart binder's rule defines membership. */}
                  {(isSmart || (isEdit ? editing?.source_set_id : sourceSetId.trim())) && (
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 text-xs text-coconut-600 dark:text-sand-200">
                        <input
                          type="checkbox"
                          checked={isMasterSet}
                          onChange={(e) => setIsMasterSet(e.target.checked)}
                          className="rounded border-sand-300 text-palm-500 focus:ring-palm-400 dark:border-husk-100"
                        />
                        Targeting the master set (every variant)
                      </label>
                      <p className="text-[10px] leading-snug text-coconut-400 dark:text-sand-300">
                        A master set is every variant — reverse holos, secret rares, alt
                        arts, special illustration rares.{' '}
                        <a
                          href={CARDRAKE_MASTER_SET_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="underline hover:text-palm-600 dark:hover:text-palm-300"
                        >
                          What counts (Cardrake)
                        </a>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div role="alert" className="text-[11px] text-sun-600 dark:text-sun-300">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-sand-200 pt-3 dark:border-husk-100">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded px-3 py-1.5 text-xs font-medium text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={submitting || !canSubmit}
                className="inline-flex items-center gap-1.5 rounded bg-palm-500 px-3.5 py-1.5 text-xs font-medium text-coconut-50 hover:bg-palm-600 disabled:opacity-50 dark:text-husk-300"
              >
                {submitting && <Loader2 size={12} className="animate-spin" />}
                {isEdit ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function TypeCard({
  active,
  onClick,
  icon,
  title,
  blurb,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  blurb: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-md border p-2.5 text-left transition ${
        active
          ? 'border-palm-400 bg-palm-50 dark:border-palm-300 dark:bg-husk-100'
          : 'border-sand-300 bg-coconut-50 hover:border-sand-400 dark:border-husk-100 dark:bg-husk-100'
      }`}
    >
      <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-coconut-700 dark:text-sand-50">
        <span className={active ? 'text-palm-600 dark:text-palm-300' : 'text-coconut-400'}>
          {icon}
        </span>
        {title}
      </div>
      <p className="text-[10px] leading-snug text-coconut-400 dark:text-sand-300">{blurb}</p>
    </button>
  )
}
