/** Want (sun) / Own (palm) button tones, shared so the inline quick actions
 *  ({@link QuickActions}) and the multi-select bulk bar ({@link BulkActionBar},
 *  #781) read identically. Kept in its own module so each consumer can stay a
 *  components-only file (react-refresh). */
export const QUICK_ACTION_TONES = {
  sun: {
    active: 'border-sun-400 bg-sun-400/20 text-husk-500 dark:bg-sun-400/25 dark:text-sun-200',
    idle: 'border-sand-300 bg-sand-100 text-coconut-500 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-200 dark:hover:bg-husk-200',
  },
  palm: {
    active: 'border-palm-500 bg-palm-500/15 text-palm-600 dark:bg-palm-400/20 dark:text-palm-200',
    idle: 'border-sand-300 bg-sand-100 text-coconut-500 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-200 dark:hover:bg-husk-200',
  },
} as const
