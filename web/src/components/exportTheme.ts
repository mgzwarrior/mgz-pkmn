/**
 * exportTheme — resolve which color theme an export request should carry
 * (#598).
 *
 * The xlsx is a screen artifact, so it follows the app's current theme
 * (the `.dark` class the pre-paint script / ThemeToggle keep on `<html>`).
 * The PDFs (binder, condensed, checklist, set ID cards) are print
 * artifacts: they stay light unless the user opted in via the
 * "Dark PDF exports" setting.
 */
import type { ExportFormat } from '../types'

export type ExportTheme = 'light' | 'dark'

/** The app theme at this moment, read off the `<html>` class. */
export function appTheme(): ExportTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function exportTheme(format: ExportFormat, darkPdfExports: boolean): ExportTheme {
  if (format === 'xlsx') return appTheme()
  return darkPdfExports ? 'dark' : 'light'
}
