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
          className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 text-zinc-100"
        >
          <div className="max-w-lg w-full rounded-lg border border-red-800 bg-zinc-900 p-6 shadow-2xl">
            <h1 className="mb-2 text-lg font-semibold text-red-400">
              Something went wrong.
            </h1>
            <p className="mb-4 text-sm text-zinc-300">
              The page hit an unexpected error. Reloading often clears it. If it
              keeps happening, please report it so we can fix it.
            </p>
            <pre className="mb-4 max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400 whitespace-pre-wrap break-words">
              {this.state.error.message || String(this.state.error)}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 transition-colors"
              >
                Reload page
              </button>
              <a
                href={ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-red-800 bg-red-900/30 px-4 py-1.5 text-sm text-red-200 hover:bg-red-900/50 transition-colors"
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
