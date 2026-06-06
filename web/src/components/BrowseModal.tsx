/**
 * BrowseModal — Radix Dialog wrapper around <BrowsePanel/>.
 *
 * Header chip / Tour step open this overlay; the discovery-mode tab in
 * App.tsx renders <BrowsePanel/> directly. All state + effects live in
 * the shared `useBrowseController` hook so behaviour matches both
 * surfaces. See [BrowsePanel](./BrowsePanel.tsx) for view internals.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { BrowsePanel } from './BrowsePanel'
import { useBrowseController } from './useBrowseController'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BrowseModal({ open, onOpenChange }: Props) {
  const controller = useBrowseController(open)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 dark:bg-husk-500/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby="browse-description"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(1100px,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200 shadow-2xl"
        >
          <BrowsePanel
            controller={controller}
            inDialog
            descriptionId="browse-description"
            titleSlot={
              <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
                {controller.activeSet ? controller.activeSet.name : 'Browse sets'}
              </Dialog.Title>
            }
            closeSlot={
              <Dialog.Close asChild>
                <button
                  aria-label="Close"
                  className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-700 dark:hover:text-sand-50"
                >
                  <X size={18} />
                </button>
              </Dialog.Close>
            }
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
