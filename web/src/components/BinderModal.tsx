/**
 * BinderModal — the single create-and-edit surface for binders (#679, #681).
 *
 * The Binders tab creates two things here: a **physical binder** (a bucket
 * of cards with a cover, storage style, pocket format, and capacity) or a
 * **smart collection** (a saved rule whose membership is your matching cards).
 * The two share storage-type/master-set identity; pocket format and capacity
 * are physical-only, since a rule-based set has no fixed slots. Cover color
 * lives on the binder inventory unit (#702), not here (#723).
 *
 * - **Novice path:** name it, done. The rest is tucked behind a "More
 *   details" disclosure so the simple case stays one decision.
 * - **Vendor path:** open the details to set pocket format, capacity, the
 *   set it organizes, and a master-set target.
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
  CollectionRule,
  CollectionSummary,
  DynamicScope,
} from '../api/client'
import { BinderFilePicker } from './BinderFilePicker'
import { useBinderFiling } from './useBinderFiling'
import { BINDER_FORMAT_OPTIONS } from './binderIdentity'
import { detailDialogContentClass } from './responsiveDialog'
import { SetCombobox } from './SetCombobox'
import { useCollections } from './useCollections'

/** The single-predicate fields the smart-collection rule builder offers. */
const RULE_FIELDS = [
  { key: 'name', label: 'Name contains' },
  { key: 'types', label: 'Type is' },
  { key: 'set_id', label: 'Set is' },
  { key: 'rarity', label: 'Rarity is' },
  { key: 'number', label: 'Number is' },
] as const

type RuleField = (typeof RULE_FIELDS)[number]['key']

/** Seed values for a fresh binder created from another surface (e.g. the
 * Browse set/pokedex view, #682/#737). Applied only on create, not editing.
 * `ruleField`/`ruleValue` seed the smart-collection rule builder (a set-anchored
 * `set_id` rule from set view, a species `name` rule from pokedex view). */
export interface BinderPrefill {
  name?: string
  sourceSetId?: string
  isMasterSet?: boolean
  ruleField?: RuleField
  ruleValue?: string
}

const SCOPE_OPTIONS: { key: DynamicScope; label: string }[] = [
  { key: 'owned', label: 'My cards' },
  { key: 'catalog', label: 'Whole catalog' },
]

/** Which flavor of binder the create form is building. */
type BinderMode = 'binder' | 'smart'

//: Cardrake's master-set guide — credited source for the explainer (#681).
const CARDRAKE_MASTER_SET_URL = 'https://www.cardrake.com/guides/master-set'

function buildRule(field: RuleField, value: string): CollectionRule {
  const v = value.trim()
  return field === 'types' ? { types: [v] } : { [field]: v }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, edit this binder's identity; otherwise create a new one. */
  editing?: CollectionSummary | null
  /** Seed a fresh binder's fields (create only) — e.g. opened from Browse. */
  prefill?: BinderPrefill
  /**
   * Smart-collection-only create (#703). The Binders tab's New ▾ → Smart
   * collection opens the modal here: the physical/smart selector is hidden and
   * the form builds a `kind='dynamic'` rule. Physical binders are created from
   * "Add binder" (#702) now; the set-anchored Browse path (#682) still opens
   * this modal without `smartOnly` for its physical create.
   */
  smartOnly?: boolean
}

export function BinderModal({ open, onOpenChange, editing, prefill, smartOnly }: Props) {
  const { create, update } = useCollections()
  // A smart collection being created can file into a binder, same as a plain
  // collection (#726) — shares the picker. Edit touches identity only.
  const filing = useBinderFiling()
  const isEdit = editing != null
  // A dynamic collection edits as a smart collection; everything else as physical.
  const editMode: BinderMode = editing?.kind === 'dynamic' ? 'smart' : 'binder'

  // State is seeded once at mount from the binder being edited (or blank for
  // a create). The parent remounts this modal with a fresh `key` on each
  // open, so these lazy initializers stand in for a reset-on-open effect.
  const [mode, setMode] = useState<BinderMode>(
    isEdit ? editMode : smartOnly ? 'smart' : 'binder',
  )
  const [name, setName] = useState(() => editing?.name ?? prefill?.name ?? '')
  const [format, setFormat] = useState<BinderFormat | ''>(() => editing?.binder_format ?? '')
  const [capacity, setCapacity] = useState(() =>
    editing?.capacity != null ? String(editing.capacity) : '',
  )
  const [sourceSetId, setSourceSetId] = useState(
    () => editing?.source_set_id ?? prefill?.sourceSetId ?? '',
  )
  const [isMasterSet, setIsMasterSet] = useState(() =>
    Boolean(editing?.is_master_set ?? prefill?.isMasterSet),
  )
  const [detailsOpen, setDetailsOpen] = useState(() =>
    Boolean(
      editing?.binder_format ||
        editing?.capacity ||
        editing?.source_set_id ||
        editing?.is_master_set ||
        prefill?.sourceSetId ||
        prefill?.isMasterSet,
    ),
  )
  // Smart-collection rule state — seeded from a Browse prefill (#737) so a
  // set-anchored / species-anchored smart collection lands with its rule filled.
  const [field, setField] = useState<RuleField>(() => prefill?.ruleField ?? 'name')
  const [value, setValue] = useState(() => prefill?.ruleValue ?? '')
  const [scope, setScope] = useState<DynamicScope>('owned')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSmart = mode === 'smart'
  // The rule is only authored on create — editing a smart collection touches just
  // its identity (name/color/type/master-set), so the rule value isn't
  // required (and the rule editor is hidden) in edit mode.
  const editingRule = isSmart && !isEdit
  // Creating a smart collection offers the binder-filing picker; wait for the
  // binder list before allowing submit so the inline-create path is safe.
  const smartCreate = isSmart && !isEdit
  const canSubmit =
    name.trim().length > 0 &&
    (!editingRule || value.trim().length > 0) &&
    (!smartCreate || filing.settled)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const cap = capacity.trim() ? Number(capacity.trim()) : null
    // Physical identity (cover color #723, storage type #726) lives on the
    // binder inventory unit (#702) now, not on a collection/rule — so the
    // only physical fields set here are the binder-kind's own format/capacity.
    try {
      if (isEdit && editing) {
        await update(editing.id, {
          name: name.trim(),
          binder_type: null,
          ...(editMode === 'binder'
            ? {
                binder_format: format || null,
                capacity: cap,
                ...(editing.source_set_id ? { is_master_set: isMasterSet } : {}),
              }
            : { is_master_set: isMasterSet }),
        })
      } else if (isSmart) {
        const target = await filing.resolveTarget()
        await create(name.trim(), {
          kind: 'dynamic',
          rule: buildRule(field, value),
          dynamic_scope: scope,
          is_master_set: isMasterSet,
          ...(target != null ? { binder_id: target } : {}),
        })
        if (target != null) await filing.refresh()
      } else {
        const set = sourceSetId.trim()
        await create(name.trim(), {
          kind: 'binder',
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content
          className={detailDialogContentClass('lg:max-h-[88vh] lg:w-[min(460px,92vw)]')}
        >
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
              {isEdit
                ? editMode === 'smart'
                  ? 'Edit smart collection'
                  : 'Edit binder'
                : smartOnly
                  ? 'New smart collection'
                  : 'New binder'}
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
            Name your binder and optionally set its pocket format, capacity, and
            the set it organizes.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Mode — physical vs. smart collection. Hidden when editing (a
                binder's kind is fixed) and in smartOnly create (#703), where
                the Binders tab routes straight to the smart-collection builder. */}
            {!isEdit && !smartOnly && (
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
                  title="Smart collection"
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

            {/* A new smart collection can file into a physical binder (#726). */}
            {smartCreate && <BinderFilePicker filing={filing} />}

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
                          <SetCombobox
                            value={sourceSetId}
                            onChange={setSourceSetId}
                            inputClassName={inputClass}
                            placeholder="Search sets, e.g. Surging Sparks"
                          />
                        </label>
                      )}
                    </>
                  )}

                  {/* Master-set target — shared. A physical binder needs a set
                      anchor; a smart collection's rule defines membership. */}
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
