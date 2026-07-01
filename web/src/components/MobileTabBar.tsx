/**
 * MobileTabBar — the bottom-tab navigation for narrow viewports (#519).
 *
 * Under the `lg` breakpoint the desktop header's seven targets don't fit, so
 * we split them by *type*: destinations (where you go) live here in a
 * thumb-reachable, always-labeled bar; utility (Settings / Help / theme) folds
 * behind the header avatar's sheet. Desktop keeps its header chips + rail and
 * never renders this bar.
 *
 * Four destinations, each an icon + word so the glyphs are learnable without a
 * tour: Discover (the Swipe / Browse / Search workspace), Backpack (the
 * library), Insights (the collection dashboard), and Account.
 */
import { Backpack, BarChart3, Compass, CircleUser } from 'lucide-react'

export type MobileTab = 'discover' | 'backpack' | 'insights' | 'account'

const TABS: { value: MobileTab; label: string; icon: typeof Compass }[] = [
  { value: 'discover', label: 'Discover', icon: Compass },
  { value: 'backpack', label: 'Backpack', icon: Backpack },
  { value: 'insights', label: 'Insights', icon: BarChart3 },
  { value: 'account', label: 'Account', icon: CircleUser },
]

interface Props {
  active: MobileTab
  onSelect: (tab: MobileTab) => void
}

export function MobileTabBar({ active, onSelect }: Props) {
  // Navigation semantics (nav + aria-current), not the ARIA tabs pattern: this
  // is primary navigation between app sections, so it shouldn't take on the
  // arrow-key roving / tabpanel expectations that role="tab" implies.
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-sand-300 bg-sand-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-husk-200/80 dark:bg-husk-400/95"
    >
      {TABS.map((t) => {
        const Icon = t.icon
        const selected = active === t.value
        return (
          <button
            key={t.value}
            type="button"
            aria-current={selected ? 'page' : undefined}
            onClick={() => onSelect(t.value)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
              selected
                ? 'text-palm-600 dark:text-sun-300'
                : 'text-coconut-400 hover:text-coconut-600 dark:text-sand-300 dark:hover:text-sand-50'
            }`}
          >
            <Icon size={20} aria-hidden />
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
