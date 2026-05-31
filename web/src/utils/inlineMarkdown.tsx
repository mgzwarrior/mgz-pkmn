import { Fragment, type ReactNode } from 'react'

/**
 * Render a CHANGELOG bullet's inline Markdown to React nodes: `[text](url)`
 * links, `` `code` `` spans, and `**bold**` emphasis — everything else as
 * plain text. Returns React elements (not HTML strings), so there's no
 * dangerouslySetInnerHTML and no escaping to get wrong. Kept minimal — the
 * bullets only use those three constructs.
 */
export function renderInlineMarkdown(text: string): ReactNode[] {
  // Alternation order matters: bold `**…**` must be tried before a bare
  // run so the double-asterisks are consumed as a unit.
  const pattern =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={nodes.length}>{text.slice(lastIndex, match.index)}</Fragment>,
      )
    }
    if (match[1] !== undefined && match[2] !== undefined) {
      nodes.push(
        <a
          key={nodes.length}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-coconut-300 hover:decoration-palm-500 dark:decoration-sand-400 dark:hover:decoration-sun-300"
        >
          {match[1]}
        </a>,
      )
    } else if (match[3] !== undefined) {
      nodes.push(
        <code
          key={nodes.length}
          className="rounded bg-sand-200 dark:bg-husk-100 px-1 py-0.5 text-[0.85em] text-coconut-600 dark:text-sand-200"
        >
          {match[3]}
        </code>,
      )
    } else if (match[4] !== undefined) {
      nodes.push(
        <strong key={nodes.length} className="font-semibold text-coconut-700 dark:text-sand-50">
          {match[4]}
        </strong>,
      )
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={nodes.length}>{text.slice(lastIndex)}</Fragment>)
  }
  return nodes
}
