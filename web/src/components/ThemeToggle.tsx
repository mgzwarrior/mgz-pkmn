/**
 * ThemeToggle — light/dark toggle for the demo SPA.
 *
 * Mirrors the marketing site's `site/src/components/ThemeToggle.astro`:
 * flips `.dark` on `<html>` and persists in `localStorage` under the
 * same `theme` key, so the choice survives reloads and roundtrips
 * between the SPA and the marketing site (if they ever share an
 * origin) without re-prompting. The pre-paint script in `index.html`
 * is the source of truth for the *initial* class — this component is
 * only the user-facing toggle.
 *
 * Icons follow lucide-react (Sun/Moon) so they match the rest of the
 * SPA's icon system. The shown icon is the theme you'd switch *to*.
 */
import { useCallback, useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  // Mirror the actual <html> class on first mount instead of guessing —
  // the pre-paint script already resolved it before React loaded.
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.classList.contains('dark')
  })

  // Sync if the OS theme changes mid-session and the user hasn't pinned
  // a choice. Symmetric with how the pre-paint script resolves on load.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    let cancelled = false
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onChange(event: MediaQueryListEvent) {
      if (cancelled) return
      try {
        if (localStorage.getItem('theme')) return // user-pinned, ignore
      } catch {
        // localStorage unavailable; fall through and follow the OS.
      }
      document.documentElement.classList.toggle('dark', event.matches)
      setIsDark(event.matches)
    }
    mq.addEventListener('change', onChange)
    return () => {
      cancelled = true
      mq.removeEventListener('change', onChange)
    }
  }, [])

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // Best-effort persistence; the toggle still works for the session.
    }
    setIsDark(next)
  }, [])

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      title="Toggle color theme"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-coconut-500 hover:text-coconut-700 hover:bg-sand-100 dark:text-sand-200 dark:hover:text-sand-50 dark:hover:bg-husk-100 transition"
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
