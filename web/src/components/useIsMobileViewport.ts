import { useEffect, useState } from 'react'

// Mirrors the app shell's `lg` mobile/desktop split (App.tsx's sidebar,
// bottom tab bar, etc. all gate on the same breakpoint). Real conditional
// rendering rather than a CSS `hidden`/`lg:hidden` pair — keeps the DOM
// (and with it tab / screen-reader order) matching what's on screen, and
// avoids mounting both variants at once.
const MOBILE_QUERY = '(max-width: 1023px)'

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(MOBILE_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
