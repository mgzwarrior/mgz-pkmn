/**
 * MobileUtilitySheet — the header "More" affordance for narrow viewports (#519).
 *
 * The desktop header carries utility controls (Settings / Help / theme) inline;
 * on mobile they'd crowd out the brand, so they collapse behind a single
 * trigger that opens a bottom sheet. Destinations (Search, Library, Insights,
 * Account) live in the {@link MobileTabBar} instead, so this holds only the
 * utility set — hence a "More" menu rather than an account avatar.
 *
 * Presentational: the caller supplies the actual controls as children (each a
 * labeled row), so the real Settings / Help / theme components mount here
 * unchanged and manage their own modals.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Menu, X } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  // Optional controlled open state, so the caller can close the sheet when it
  // launches something over it (e.g. the tour). Uncontrolled when omitted.
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function MobileUtilitySheet({ children, open, onOpenChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="More"
          className="rounded-md p-1.5 text-coconut-600 hover:bg-sand-200 dark:text-sand-200 dark:hover:bg-husk-100"
        >
          <Menu size={20} aria-hidden />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm lg:hidden dark:bg-husk-500/70" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-1 rounded-t-2xl border-t border-sand-300 bg-sand-50 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 shadow-2xl lg:hidden dark:border-husk-50 dark:bg-husk-200">
          <div className="mb-1 flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-coconut-700 dark:text-sand-50">
              More
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded p-1 text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
              >
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Settings, help, and appearance.
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * UtilityRow — a labeled row in the sheet pairing a control (the existing
 * icon-button component) with its name, so the icon-only header controls read
 * clearly in the stacked mobile menu.
 */
export function UtilityRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-coconut-700 dark:text-sand-50">
      <span>{label}</span>
      {children}
    </div>
  )
}
