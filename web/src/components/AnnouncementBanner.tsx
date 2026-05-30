/**
 * AnnouncementBanner — slim, dismissible top banner pointing at the v1
 * interest survey on Tally. Mirrors site/src/components/
 * AnnouncementBanner.astro on the marketing site; same survey URL, same
 * dismissal-key suffix, separate localStorage origin (per-host).
 *
 * Source of truth for the questions: docs/marketing/surveys/v1-interest-survey.md.
 * When shipping a new survey, bump the URL + `DISMISS_KEY` suffix in both
 * components together so prior dismissers see the new banner.
 */
import { useState } from 'react'
import { X } from 'lucide-react'

const SURVEY_URL = 'https://tally.so/r/gDvZOM'
const DISMISS_KEY = 'mgz-pkmn-announce-survey-v1'

/**
 * Read the dismiss flag synchronously so initial render already knows
 * whether to show the banner — avoids both a flash of an already-
 * dismissed banner and the eslint-flagged cascading-render pattern of
 * setting state from an effect. Safe because this SPA is client-only;
 * if we ever introduce SSR, gate this on `typeof window !== 'undefined'`.
 */
function readInitialVisible(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) !== '1'
  } catch {
    // Storage unavailable (private mode, blocked) — show by default.
    return true
  }
}

export function AnnouncementBanner() {
  const [visible, setVisible] = useState(readInitialVisible)

  const dismiss = () => {
    setVisible(false)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Best-effort — banner is hidden for this session even if the
      // choice can't be persisted.
    }
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Site announcement"
      className="border-b border-blue-500/40 bg-blue-500/15 text-blue-50"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-sm">
        <span aria-hidden="true" className="text-base">
          📣
        </span>
        <p className="flex-1 leading-snug">
          <span className="font-semibold">We&apos;re listening.</span>{' '}
          Help shape what mgz-pkmn ships next —{' '}
          <a
            href={SURVEY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2 hover:no-underline"
          >
            take the 2-min survey →
          </a>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="rounded-md p-1 text-blue-100 transition-colors hover:bg-blue-500/30 hover:text-white"
        >
          <X size={16} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
