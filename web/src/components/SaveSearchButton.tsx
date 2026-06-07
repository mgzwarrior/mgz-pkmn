/**
 * SaveSearchButton — promotes the currently-loaded run into the
 * saved-search sidebar.
 *
 * The button is only rendered when there is a `currentRunId` (i.e. a
 * fresh `/bulk` stream completed or a saved search is loaded). Clicking
 * it prompts the user for a name, then PATCHes `/api/v1/runs/{id}` with
 * that name plus the current ResultsTable view state. The sidebar
 * re-fetches on the next mount + after each bulk completion; we also
 * force a refresh by bumping the in-store `runs` list directly.
 *
 * If the run is already saved, the label shifts to *Rename* and the
 * prompt is pre-filled with the existing name — same call, just a
 * different affordance.
 */
import { useCallback, useEffect, useState } from 'react'
import { Bookmark } from 'lucide-react'
import { listRuns, saveRun } from '../api/client'
import type { UseAuthResult } from '../hooks/useAuth'
import { useAppStore } from '../store'
import { ProviderPickerModal } from './SignInChip'
import { consumePendingSaveSearch, storePendingSaveSearch } from './pendingSaveSearch'

const LIST_LIMIT = 50

type SaveSearchAuth = Pick<UseAuthResult, 'user' | 'authEnabled' | 'loading'>

interface Props {
  auth: SaveSearchAuth
}

export function SaveSearchButton({ auth }: Props) {
  const { currentRunId, runs, setRuns, viewState } = useAppStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingSaveName, setPendingSaveName] = useState<string | null>(null)

  const existing = runs.find((r) => r.id === currentRunId)
  const needsSignIn = auth.authEnabled && !auth.loading && auth.user === null

  const saveNamedRun = useCallback(
    async (name: string) => {
      if (currentRunId == null) return
      setSaving(true)
      setError(null)
      try {
        await saveRun(currentRunId, name, viewState)
        // Re-pull the canonical saved list so the new entry appears (or
        // the renamed entry updates) without waiting for the next mount.
        const { items } = await listRuns(LIST_LIMIT)
        setRuns(items)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save search')
      } finally {
        setSaving(false)
      }
    },
    [currentRunId, viewState, setRuns],
  )

  useEffect(() => {
    if (auth.user === null || pendingSaveName === null) return
    const name = pendingSaveName
    queueMicrotask(() => {
      setPendingSaveName(null)
      setPickerOpen(false)
      consumePendingSaveSearch()
      void saveNamedRun(name)
    })
  }, [auth.user, pendingSaveName, saveNamedRun])

  const handleSave = useCallback(() => {
    if (currentRunId == null) return
    const defaultName = existing?.name ?? ''
    const name = window.prompt(
      existing ? 'Rename this saved search' : 'Name this saved search',
      defaultName,
    )
    if (name == null) return
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError('A name is required to save a search.')
      return
    }
    if (needsSignIn) {
      setPendingSaveName(trimmed)
      storePendingSaveSearch({ runId: currentRunId, name: trimmed, viewState })
      setPickerOpen(true)
      return
    }
    void saveNamedRun(trimmed)
  }, [currentRunId, existing, needsSignIn, saveNamedRun, viewState])

  if (currentRunId == null) return null

  const ariaLabel = needsSignIn
    ? 'Sign in to save this search'
    : existing
      ? 'Rename this saved search'
      : 'Save this search'
  const label = saving ? 'Saving...' : needsSignIn ? 'Sign in to save' : existing ? 'Rename' : 'Save search'

  return (
    <div className="flex items-center gap-2">
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || auth.loading}
        aria-label={ariaLabel}
        className="flex items-center gap-1 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-100 dark:bg-husk-200 px-2 py-1 text-xs text-coconut-700 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        <Bookmark size={12} aria-hidden />
        {label}
      </button>
      <ProviderPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        intent="save-search"
      />
    </div>
  )
}
