import { describe, it, expect, afterEach } from 'vitest'
import { appTheme, exportTheme } from './exportTheme'

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('appTheme', () => {
  it('reads light off a bare <html>', () => {
    expect(appTheme()).toBe('light')
  })

  it('reads dark when the .dark class is present', () => {
    document.documentElement.classList.add('dark')
    expect(appTheme()).toBe('dark')
  })
})

describe('exportTheme', () => {
  it('xlsx follows the app theme, not the PDF opt-in', () => {
    expect(exportTheme('xlsx', true)).toBe('light')
    document.documentElement.classList.add('dark')
    expect(exportTheme('xlsx', false)).toBe('dark')
  })

  it('PDF formats stay light unless the user opted in', () => {
    document.documentElement.classList.add('dark')
    for (const format of ['pdf', 'condensed-pdf', 'checklist'] as const) {
      expect(exportTheme(format, false)).toBe('light')
      expect(exportTheme(format, true)).toBe('dark')
    }
  })
})
