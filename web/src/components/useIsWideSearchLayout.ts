import { useEffect, useState } from 'react'

// Mirrors App.tsx's `min-[1100px]` breakpoint for the side-by-side Search
// workspace (editor + results as two columns instead of a stacked column).
const WIDE_SEARCH_QUERY = '(min-width: 1100px)'

export function useIsWideSearchLayout(): boolean {
  const [isWide, setIsWide] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(WIDE_SEARCH_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(WIDE_SEARCH_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsWide(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isWide
}
