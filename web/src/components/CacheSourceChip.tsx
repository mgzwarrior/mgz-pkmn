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
import { Database, CloudDownload, CloudOff } from 'lucide-react'
import { useAppStore } from '../store'

export function CacheSourceChip() {
  const { settings, cacheStatus } = useAppStore()

  if (!settings.showTimer) return null
  if (cacheStatus == null) return null

  // Four distinct outcomes:
  //   HIT / STALE         — served from cache (STALE also kicked off a
  //                          background pricing refresh, but still a cache read)
  //   MISS                — a real upstream fetch happened
  //   MISS-CACHE-ONLY     — anonymous cache-only mode: a disk miss that
  //                          *skips* upstream entirely, so it's neither cache
  //                          nor upstream — the data simply wasn't warmed.
  const { Icon, label } =
    cacheStatus === 'HIT'
      ? { Icon: Database, label: 'from cache' }
      : cacheStatus === 'STALE'
        ? { Icon: Database, label: 'from cache · refreshing' }
        : cacheStatus === 'MISS-CACHE-ONLY'
          ? { Icon: CloudOff, label: 'not in cache' }
          : { Icon: CloudDownload, label: 'from upstream' }

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
