/**
 * MobileTabBar — bottom-tab navigation for viewports under the `lg`
 * breakpoint (#519, part of the responsive overhaul #518). Replaces the
 * old pattern of stripping header labels down to a bookmark / heart glyph:
 * mobile gets its own thumb-reachable nav with four labeled destinations —
 * Discover, Backpack, Insights, Account — instead of a shrunk desktop header.
 *
 * Discover and Backpack swap the content App renders in place (see the
 * `mobileSection` state in App.tsx); Insights and Account open their
 * existing dialogs directly, reusing InsightsNavButton / SignInChip's
 * `tab` variant so there's one source of truth for each surface.
 *
 * Desktop (`lg` and up) is untouched — this bar doesn't render there, and
 * the sidebar Backpack + header chips keep working exactly as before.
 */
import { Backpack, Compass } from 'lucide-react'
import { InsightsNavButton } from './InsightsNavButton'
import { SignInChip } from './SignInChip'

export type MobileSection = 'discover' | 'backpack'

interface Props {
  section: MobileSection
  onSelectSection: (section: MobileSection) => void
}

const TAB_CLASS =
  'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors min-w-0'
const ACTIVE_CLASS = 'text-palm-600 dark:text-sun-300'
const INACTIVE_CLASS =
  'text-coconut-400 hover:text-coconut-600 dark:text-sand-300 dark:hover:text-sand-100'

export function MobileTabBar({ section, onSelectSection }: Props) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-1 border-t border-sand-300 bg-sand-50/95 px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur dark:border-husk-200/80 dark:bg-husk-400/95 lg:hidden"
    >
      <button
        type="button"
        onClick={() => onSelectSection('discover')}
        aria-current={section === 'discover' ? 'page' : undefined}
        className={`${TAB_CLASS} ${section === 'discover' ? ACTIVE_CLASS : INACTIVE_CLASS}`}
      >
        <Compass size={20} aria-hidden />
        Discover
      </button>
      <button
        type="button"
        onClick={() => onSelectSection('backpack')}
        aria-current={section === 'backpack' ? 'page' : undefined}
        className={`${TAB_CLASS} ${section === 'backpack' ? ACTIVE_CLASS : INACTIVE_CLASS}`}
      >
        <Backpack size={20} aria-hidden />
        Backpack
      </button>
      <InsightsNavButton variant="tab" />
      <SignInChip variant="tab" />
    </nav>
  )
}
