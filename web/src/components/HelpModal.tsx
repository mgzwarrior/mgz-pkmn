/**
 * HelpModal — onboarding/help dialog with sections covering queries,
 * settings, exports, and shortcuts. Includes a "Take the tour" button
 * that hands control off to the Tour component.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { CircleHelp, X } from 'lucide-react'
import { useState } from 'react'

const FIRST_VISIT_KEY = 'mgz-pkmn:seen-help'

interface Props {
  onStartTour: () => void
}

export function HelpModal({ onStartTour }: Props) {
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState(
    () => typeof window !== 'undefined' && !window.localStorage.getItem(FIRST_VISIT_KEY),
  )

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next && hint) {
      setHint(false)
      window.localStorage.setItem(FIRST_VISIT_KEY, '1')
    }
  }

  function handleTakeTour() {
    setOpen(false)
    onStartTour()
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          className={`relative flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors ${
            hint ? 'ring-2 ring-blue-500 animate-pulse' : ''
          }`}
          title="Help"
          aria-label="Open help"
        >
          <CircleHelp size={15} />
          Help
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-zinc-100">
              How to use mgz-pkmn
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="rounded p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 text-sm text-zinc-300">
            <Section title="What this does">
              <p>
                Paste a list of Pokémon cards (one per line), click{' '}
                <Kbd>Look up</Kbd>, and get matched cards with current market
                prices and negotiation comps. Then download an .xlsx, PDF
                binder, condensed PDF, or checklist for the table.
              </p>
            </Section>

            <Section title="Writing queries">
              <p className="mb-2 text-zinc-400">
                One card per line. Blank lines and <code>#</code> comments are
                skipped. Common formats:
              </p>
              <Examples
                rows={[
                  ['Charizard | Base Set | 4/102', 'Most precise: name, set, number'],
                  ['Pikachu | Jungle', 'Name + set'],
                  ['Squirtle | 7/102', 'Name + card number'],
                  ['Mew ex', 'Name only — best match wins'],
                  ['Charizard [holo]', 'Variant hint in brackets'],
                  ['top:5 Charizard cards', 'Bulk: top N by price'],
                  ['All Energy Removal cards | Base Set', 'Bulk: every match in a set'],
                  ['Pikachu >=20 <=50', 'Price-bound filter'],
                ]}
              />
            </Section>

            <Section title="Settings">
              <Definitions
                rows={[
                  ['API key', 'Optional pokemontcg.io key — raises the rate limit on bursty lookups.'],
                  ['Source tag', 'Labels every row in the export (e.g. "binder1") so multiple runs can be merged downstream.'],
                  ['Sort order', 'Applied within each tag group in every export — card number, price, release date, or alphabetical.'],
                  ['Max price cap', 'Drops bulk top-N results above the cap. Single-card lookups always show through (flagged amber).'],
                  ['Deduplicate by card ID', 'Removes duplicates across queries when the same card matched more than once.'],
                  ['Hide images', 'Skip thumbnails — faster table, smaller exports.'],
                ]}
              />
            </Section>

            <Section title="Exports">
              <Definitions
                rows={[
                  ['Download .xlsx', 'Spreadsheet with embedded thumbnails, market price, and 80/85/90/95% negotiation comps.'],
                  ['PDF binder', 'Printable binder pages, one card per cell with image + price.'],
                  ['Condensed PDF', 'Same data, denser layout for quick reference.'],
                  ['Checklist', 'Per-tag printable checklist PDF.'],
                  ['Set ID cards', 'Printable set identifier cutouts — no input rows needed.'],
                ]}
              />
            </Section>

            <Section title="Shortcuts">
              <Definitions
                rows={[
                  [<Kbd key="run">⌘ Enter</Kbd>, 'Run the lookup'],
                  [<Kbd key="brand">Brand × 5</Kbd>, 'Click the logo five times for a surprise'],
                ]}
              />
            </Section>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-zinc-700 px-5 py-4">
            <span className="text-xs text-zinc-500">
              New here? Take the interactive tour.
            </span>
            <button
              onClick={handleTakeTour}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Take the tour
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-200">
      {children}
    </kbd>
  )
}

function Examples({ rows }: { rows: [string, string][] }) {
  return (
    <ul className="space-y-1.5">
      {rows.map(([query, desc]) => (
        <li key={query} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <code className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-100">
            {query}
          </code>
          <span className="text-xs text-zinc-500">{desc}</span>
        </li>
      ))}
    </ul>
  )
}

function Definitions({ rows }: { rows: [React.ReactNode, string][] }) {
  return (
    <dl className="space-y-2">
      {rows.map(([term, desc], i) => (
        <div key={i} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
          <dt className="font-medium text-zinc-200 sm:min-w-[140px]">{term}</dt>
          <dd className="text-xs text-zinc-400 sm:flex-1 sm:text-sm">{desc}</dd>
        </div>
      ))}
    </dl>
  )
}
