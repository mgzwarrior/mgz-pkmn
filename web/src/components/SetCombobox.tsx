/**
 * SetCombobox — a searchable set-name picker (#682).
 *
 * The binder modal's "Organizes a set" field used to be a raw Set ID box.
 * This filters the baked set catalog ([BAKED_SETS](../data/sets.ts)) by name
 * or ID as you type, shows logo + name + ID, and resolves the pick to the
 * set's ID — which is what the API stores. A typed value that doesn't match a
 * known set is passed through as-is, so a raw ID still works as a fallback.
 *
 * BAKED_SETS is the same zero-round-trip catalog the export picker uses; a set
 * that landed upstream since the last bake won't autocomplete, but typing its
 * ID still works.
 */
import { useMemo, useState } from 'react'
import { setLogoUrl } from '../api/client'
import { BAKED_SETS } from '../data/sets'
import type { SetInfo } from '../types'

interface Props {
  /** Current set ID (or a raw typed value). */
  value: string
  onChange: (id: string) => void
  inputClassName?: string
  placeholder?: string
  id?: string
}

const MAX_MATCHES = 8

function setById(id: string): SetInfo | undefined {
  return BAKED_SETS.find((s) => s.id === id)
}

export function SetCombobox({ value, onChange, inputClassName, placeholder, id }: Props) {
  // Show the set name when the value is a known ID; otherwise the raw text.
  const [query, setQuery] = useState(() => setById(value)?.name ?? value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [] as SetInfo[]
    return BAKED_SETS.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    ).slice(0, MAX_MATCHES)
  }, [query])

  // Resolve free text to the stored set ID. An exact name/ID match commits
  // that set's ID; empty clears the anchor. A partial fragment that still
  // matches known sets isn't a valid anchor — leave it uncommitted (empty)
  // so a half-typed name like "Surging" never gets stored as a set ID; the
  // user resolves it by picking an option or finishing the exact name. Text
  // that matches no known set passes through as a raw ID (a set that landed
  // upstream since the last catalog bake still works).
  function resolve(text: string) {
    const raw = text.trim()
    const q = raw.toLowerCase()
    if (!q) {
      onChange('')
      return
    }
    const exact = BAKED_SETS.find((s) => s.name.toLowerCase() === q || s.id.toLowerCase() === q)
    if (exact) {
      onChange(exact.id)
      return
    }
    const isFragment = BAKED_SETS.some(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    )
    onChange(isFragment ? '' : raw)
  }

  function pick(s: SetInfo) {
    setQuery(s.name)
    onChange(s.id)
    setOpen(false)
  }

  const showList = open && matches.length > 0

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder={placeholder ?? 'Search sets…'}
        onChange={(e) => {
          setQuery(e.target.value)
          resolve(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        // Delay close so a click on an option lands before blur hides it.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(a + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && showList && matches[active]) {
            e.preventDefault()
            pick(matches[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        className={inputClassName}
      />
      {showList && (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-md border border-sand-300 bg-coconut-50 py-1 shadow-lg dark:border-husk-100 dark:bg-husk-100"
        >
          {matches.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                // Keep input focus so the click resolves before blur closes.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-coconut-700 dark:text-sand-50 ${
                  i === active ? 'bg-sand-200 dark:bg-husk-200' : ''
                }`}
              >
                <img
                  src={setLogoUrl(s.id)}
                  alt=""
                  className="h-4 w-8 shrink-0 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-coconut-400 dark:text-sand-300">
                  {s.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
