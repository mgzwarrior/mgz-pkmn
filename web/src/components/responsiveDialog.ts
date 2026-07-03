/**
 * detailDialogContentClass — shared `Dialog.Content` treatment for the
 * "drill-down" views reached from a mobile bottom tab (Binder/Collection/
 * Wishlist detail, Account): full-screen below `lg` so tapping into one reads
 * as a page takeover rather than a floating card, and the existing
 * centered-card dialog at `lg`+ (#857).
 *
 * `desktopSize` is a literal Tailwind fragment (e.g.
 * `'lg:max-h-[85vh] lg:w-[min(640px,92vw)]'`) — kept as a plain string
 * argument rather than composed from parts so every class token appears
 * verbatim in source for Tailwind's scanner.
 */
export function detailDialogContentClass(desktopSize: string): string {
  return `fixed inset-0 z-50 flex flex-col overflow-hidden bg-sand-50 pb-[env(safe-area-inset-bottom)] dark:bg-husk-200 dark:border-husk-50 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-lg lg:border lg:border-sand-300 lg:pb-0 lg:shadow-2xl ${desktopSize}`
}
