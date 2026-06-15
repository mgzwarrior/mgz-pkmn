/**
 * CacheSourceChip — shows whether the last run's results came from the disk
 * cache or a fresh upstream fetch (#310).
 *
 * A dev-leaning signal for spotting cache regressions and confirming a
 * `warm-*` subcommand actually populated what you expected. Gated by the same
 * `showTimer` setting as the {@link LookupTimer} and rendered beside it, so it
 * stays out of the default user's way. Renders nothing until a run has
 * reported a `cache_status` on its SSE done frame.
 */
import { Database, CloudDownload } from 'lucide-react'
import { useAppStore } from '../store'

export function CacheSourceChip() {
  const { settings, cacheStatus } = useAppStore()

  if (!settings.showTimer) return null
  if (cacheStatus == null) return null

  // STALE served from cache too — it just kicked off a background pricing
  // refresh, so it still counts as a cache read for the source label.
  const fromCache = cacheStatus === 'HIT' || cacheStatus === 'STALE'
  const Icon = fromCache ? Database : CloudDownload
  const label =
    cacheStatus === 'HIT'
      ? 'from cache'
      : cacheStatus === 'STALE'
        ? 'from cache · refreshing'
        : 'from upstream'

  return (
    <div
      aria-label={`Lookup source: ${label}`}
      className="flex items-center gap-1.5 text-xs tabular-nums text-coconut-400 dark:text-sand-300"
    >
      <Icon size={12} className="text-palm-500 dark:text-sun-300" />
      <span>{label}</span>
    </div>
  )
}
