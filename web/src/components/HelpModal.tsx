/**
 * HelpModal — onboarding/help dialog with sections covering queries,
 * settings, exports, shortcuts, and what's new. Includes a "Take the
 * tour" button that hands control off to the Tour component.
 *
 * The "what's new" surface is a collapsible bar pinned below the header,
 * collapsed by default and condensed to the latest release's top features.
 * It owns the "unseen release" affordance: a small dot on the trigger and on
 * the bar when the latest changelog version differs from the user's last-seen
 * version (persisted in zustand). Expanding the bar marks the latest version
 * seen, clearing both dots.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, CircleHelp, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchChangelog } from '../api/client'
import { useAppStore } from '../store'
import type { ChangelogRelease } from '../types'
import { renderInlineMarkdown } from '../utils/inlineMarkdown'

const FIRST_VISIT_KEY = 'mgz-pkmn:seen-help'
const REPO_CHANGELOG_URL =
  'https://github.com/mgzwarrior/mgz-pkmn/blob/main/CHANGELOG.md'

// The condensed bar shows only the headline highlights of the latest release.
const MAX_FEATURES = 3

// Pick the entries that read as "what's new": prefer the `Added` section (new
// capabilities are the headline), falling back to the first section for a
// release that shipped without one. Capped so the bar stays scannable.
function topFeatures(release: ChangelogRelease | undefined): string[] {
  if (!release) return []
  const headline = release.sections.find((s) => s.name === 'Added') ?? release.sections[0]
  return headline ? headline.entries.slice(0, MAX_FEATURES) : []
}

// localStorage access can throw in some browsers/contexts (Safari private
// mode, embedded webviews with storage disabled, quota exhaustion). Wrap so
// the onboarding hint quietly degrades to "no hint" instead of crashing the
// SPA on first render.
function readSeenHelp(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return !!window.localStorage.getItem(FIRST_VISIT_KEY)
  } catch {
    return true
  }
}

function markSeenHelp(): void {
  try {
    window.localStorage.setItem(FIRST_VISIT_KEY, '1')
  } catch {
    // ignore — losing the hint dismissal is a fine fallback
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

interface Props {
  onStartTour: () => void
}

export function HelpModal({ onStartTour }: Props) {
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState(() => !readSeenHelp())
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [releases, setReleases] = useState<ChangelogRelease[] | null>(null)
  const [releasesError, setReleasesError] = useState(false)

  const lastSeen = useAppStore((s) => s.lastSeenChangelogVersion)
  const setLastSeen = useAppStore((s) => s.setLastSeenChangelogVersion)

  const latestRelease = releases?.[0]
  const latest = latestRelease?.version ?? null
  const features = topFeatures(latestRelease)

  // Fetch once on mount so the unseen-release dot can light up before the
  // user ever opens the modal. A failure leaves `releases` null + the
  // What's new section shows a fallback.
  useEffect(() => {
    let cancelled = false
    fetchChangelog(5)
      .then((data) => {
        if (!cancelled) setReleases(data)
      })
      .catch(() => {
        if (!cancelled) setReleasesError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Silent first-time catch-up: a visitor with no stored version is pinned
  // to the current latest so the dot never shows on a first visit.
  useEffect(() => {
    if (latest && lastSeen === null) setLastSeen(latest)
  }, [latest, lastSeen, setLastSeen])

  const hasUnseen = !!latest && lastSeen !== null && latest !== lastSeen

  // Expanding the What's new bar marks the latest release seen — clearing the
  // unseen dot on both the bar and the trigger. An effect (rather than the
  // click handler alone) also covers the panel being opened before the
  // changelog fetch resolved: a late-arriving `latest` still clears the dot
  // without forcing the user to collapse and re-expand.
  useEffect(() => {
    if (whatsNewOpen && latest && lastSeen !== latest) setLastSeen(latest)
  }, [whatsNewOpen, latest, lastSeen, setLastSeen])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next && hint) {
      setHint(false)
      markSeenHelp()
    }
    // Collapse the What's new bar on close so it always reopens collapsed.
    if (!next) setWhatsNewOpen(false)
  }

  function handleToggleWhatsNew() {
    setWhatsNewOpen((prev) => !prev)
  }

  function handleTakeTour() {
    setOpen(false)
    onStartTour()
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          className={`relative flex items-center gap-1.5 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2.5 py-1.5 text-sm text-coconut-600 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors sm:px-3 ${
            hint ? 'ring-2 ring-palm-400 dark:ring-sun-300 animate-pulse' : ''
          }`}
          title="Help"
          aria-label={hasUnseen ? 'Help (new release available)' : 'Help'}
        >
          <CircleHelp size={15} />
          <span className="hidden sm:inline">Help</span>
          {hasUnseen && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-palm-400 dark:bg-sun-300 ring-2 ring-sand-50 dark:ring-husk-400"
            />
          )}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 dark:bg-husk-500/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-sand-300 dark:border-husk-50 px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-coconut-700 dark:text-sand-50">
              How to use mgz-pkmn
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* What's new — collapsed by default, pinned below the header. The
              dot mirrors the trigger's unseen-release affordance. */}
          <div className="border-b border-sand-300 dark:border-husk-50">
            <button
              type="button"
              onClick={handleToggleWhatsNew}
              aria-expanded={whatsNewOpen}
              aria-controls={whatsNewOpen ? 'whats-new-panel' : undefined}
              aria-label={hasUnseen ? "What's new (new version available)" : "What's new"}
              className="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-sand-100 dark:hover:bg-husk-100 transition-colors"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
                What's new
              </span>
              {latest && (
                <span className="font-mono text-xs text-coconut-400 dark:text-sand-400">
                  v{latest}
                </span>
              )}
              {hasUnseen && (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-palm-400 dark:bg-sun-300"
                />
              )}
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={`ml-auto text-coconut-400 dark:text-sand-300 transition-transform ${
                  whatsNewOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {whatsNewOpen && (
              <div
                id="whats-new-panel"
                className="px-5 pb-4 text-sm text-coconut-600 dark:text-sand-200"
              >
                {releasesError || (releases && releases.length === 0) ? (
                  <p className="text-coconut-400 dark:text-sand-300">
                    Release notes couldn't be loaded right now. See the{' '}
                    <a
                      href={REPO_CHANGELOG_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-palm-500 dark:text-sun-300 underline hover:text-palm-400 dark:hover:text-sun-200"
                    >
                      full changelog
                    </a>
                    .
                  </p>
                ) : releases === null ? (
                  <p className="text-coconut-400 dark:text-sand-400">Loading release notes…</p>
                ) : (
                  <>
                    {latestRelease?.date && (
                      <p className="mb-2 text-xs text-coconut-400 dark:text-sand-400">
                        {formatDate(latestRelease.date)}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {features.map((entry, i) => (
                        <li key={i} className="flex gap-2 leading-relaxed">
                          <span
                            aria-hidden="true"
                            className="mt-2 h-1 w-1 shrink-0 rounded-full bg-sand-300 dark:bg-husk-50"
                          />
                          <span>{renderInlineMarkdown(entry)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs">
                      <a
                        href={REPO_CHANGELOG_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-palm-500 dark:text-sun-300 hover:text-palm-400 dark:hover:text-sun-200 transition-colors"
                      >
                        Full changelog →
                      </a>
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Body */}
          <div
            tabIndex={0}
            className="flex-1 overflow-y-auto px-5 py-4 space-y-6 text-sm text-coconut-600 dark:text-sand-200 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:ring-sun-300"
          >
            <Section title="What this does">
              <p>
                Paste a list of Pokémon cards (one per line), click{' '}
                <Kbd>Look up</Kbd>, and get matched cards with current market
                prices and negotiation comps. Then download an .xlsx, PDF
                binder, condensed PDF, or checklist for the table.
              </p>
            </Section>

            <Section title="Writing queries">
              <p className="mb-2 text-coconut-400 dark:text-sand-300">
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
                  ['All Charizard cards | Base Set', 'Bulk: every match in a set'],
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
                  [<Kbd key="run">Ctrl/Cmd + Enter</Kbd>, 'Run the lookup'],
                  [<Kbd key="brand">Brand × 5</Kbd>, 'Click the logo five times for a surprise'],
                ]}
              />
            </Section>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-sand-300 dark:border-husk-50 px-5 py-4">
            <span className="text-xs text-coconut-400 dark:text-sand-300">
              New here? Take the interactive tour.
            </span>
            <button
              onClick={handleTakeTour}
              className="rounded-md bg-sun-300 px-3 py-1.5 text-sm font-medium text-coconut-700 hover:bg-sun-400 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200 transition-colors"
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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-1.5 py-0.5 font-mono text-xs text-coconut-600 dark:text-sand-200">
      {children}
    </kbd>
  )
}

function Examples({ rows }: { rows: [string, string][] }) {
  return (
    <ul className="space-y-1.5">
      {rows.map(([query, desc]) => (
        <li key={query} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <code className="rounded bg-sand-200 dark:bg-husk-100 px-2 py-0.5 font-mono text-xs text-coconut-700 dark:text-sand-50">
            {query}
          </code>
          <span className="text-xs text-coconut-400 dark:text-sand-300">{desc}</span>
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
          <dt className="font-medium text-coconut-600 dark:text-sand-200 sm:min-w-[140px]">{term}</dt>
          <dd className="text-xs text-coconut-400 dark:text-sand-300 sm:flex-1 sm:text-sm">{desc}</dd>
        </div>
      ))}
    </dl>
  )
}
