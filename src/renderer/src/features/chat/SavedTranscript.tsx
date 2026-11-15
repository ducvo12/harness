import { useEffectEvent, useLayoutEffect, useRef } from 'react'
import type { ConversationDetail } from '../../../../shared/agent'
import type { Result } from '../../../../shared/chat'
import FormattedResponse from './FormattedResponse'

export type ReadingPosition = 'end' | { messageId: string; offset: number }

interface SavedTranscriptProps {
  path: string[]
  result?: Result<ConversationDetail>
  retry: () => void
  readPosition: () => ReadingPosition | undefined
  savePosition: (position: ReadingPosition) => void
}

export default function SavedTranscript({ path, result, retry, readPosition, savePosition }: SavedTranscriptProps) {

  if (!result) return <p className="pane-message" role="status">Loading transcript…</p>
  if (!result.ok) return (
    <div className="pane-message">
      <p role="alert">{result.error}</p>
      <button type="button" onClick={retry}>Retry</button>
    </div>
  )

  return <Transcript transcript={result.value} path={path} readPosition={readPosition} savePosition={savePosition} />
}

function Transcript({ transcript, path, readPosition, savePosition }: Pick<SavedTranscriptProps, 'path' | 'readPosition' | 'savePosition'> & {
  transcript: ConversationDetail
}) {
  const viewport = useRef<HTMLElement>(null)
  const messages = useRef<HTMLDivElement>(null)
  const currentPosition = useEffectEvent(readPosition)

  // Docking can move the view to a different branch of the React tree and
  // change line wrapping. Restore the visible message before painting.
  useLayoutEffect(() => {
    const scroller = viewport.current!
    const list = messages.current!
    function restore() {
      const position = currentPosition() ?? 'end'
      if (position === 'end') {
        scroller.scrollTop = scroller.scrollHeight
        return
      }
      const message = list.querySelector(`[data-message-id="${CSS.escape(position.messageId)}"]`)
      if (message) {
        const rect = message.getBoundingClientRect()
        const offset = Math.min(position.offset, rect.height - 1)
        scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top + offset
      }
    }

    restore()
    const observer = new ResizeObserver(restore)
    observer.observe(scroller)
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  function rememberPosition() {
    const scroller = viewport.current!
    if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1) {
      savePosition('end')
      return
    }

    const top = scroller.getBoundingClientRect().top
    const rows = messages.current!.children
    // The first message intersecting the viewport is the reading anchor.
    let low = 0
    let high = rows.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (rows[middle].getBoundingClientRect().bottom <= top) low = middle + 1
      else high = middle
    }

    const row = rows.item(low) as HTMLElement | null
    if (row) savePosition({ messageId: row.dataset.messageId!, offset: top - row.getBoundingClientRect().top })
  }

  return (
    <section className="saved-transcript" ref={viewport} onScroll={rememberPosition} tabIndex={0} aria-label="Chat transcript">
      <div className="saved-transcript-header">
        <p>{path.join(' / ')}</p>
        <h1>{transcript.title}</h1>
      </div>

      <div ref={messages}>
        {!transcript.messages.length && <p>No saved messages.</p>}

        {transcript.messages.map(message => (
          <article className="saved-message" data-message-id={message.id} key={message.id}>
            <p className="message-role">{message.role === 'user' ? 'You' : path[0]}</p>

            {message.role === 'assistant' ? <FormattedResponse text={message.content} /> : <p className="saved-user-message">{message.content}</p>}

            {message.error && <p className="saved-message-status">{message.error}</p>}
            {message.interrupted && <p className="saved-message-status">Interrupted</p>}
          </article>
        ))}
      </div>
    </section>
  )
}
