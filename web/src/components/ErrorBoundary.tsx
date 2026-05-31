/**
 * ErrorBoundary — catches render-time errors anywhere below it so the
 * user sees an actionable message and a link to file an issue instead
 * of a blank white page.
 *
 * React only supports error boundaries as class components.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

const ISSUES_URL = 'https://github.com/mgzwarrior/mgz-pkmn/issues'

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught a render error:', error, info)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="min-h-screen flex items-center justify-center bg-sand-50 dark:bg-husk-400 px-4 text-coconut-700 dark:text-sand-50"
        >
          <div className="max-w-lg w-full rounded-lg border border-ember-500/30 dark:border-ember-500/30 bg-sand-50 dark:bg-husk-200 p-6 shadow-2xl">
            <h1 className="mb-2 text-lg font-semibold text-ember-500 dark:text-ember-300">
              Something went wrong.
            </h1>
            <p className="mb-4 text-sm text-coconut-600 dark:text-sand-200">
              The page hit an unexpected error. Reloading often clears it. If it
              keeps happening, please report it so we can fix it.
            </p>
            <pre className="mb-4 max-h-40 overflow-auto rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-400 p-3 text-xs text-coconut-400 dark:text-sand-300 whitespace-pre-wrap break-words">
              {this.state.error.message || String(this.state.error)}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-4 py-1.5 text-sm text-coconut-700 dark:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
              >
                Reload page
              </button>
              <a
                href={ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-ember-500/40 bg-ember-500/15 px-4 py-1.5 text-sm text-ember-600 hover:bg-ember-500/25 dark:border-ember-500/40 dark:bg-ember-500/15 dark:text-ember-300 dark:hover:bg-ember-500/25 transition-colors"
              >
                Report on GitHub →
              </a>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
