import { useId, useRef, useState } from 'react'
import type { AgentMessage } from '../../../../../../../shared/agent'
import type { RunSnapshot } from '../../../../../../../shared/run'
import AttachedFiles from './AttachedFiles'
import RepositoryActivity from './RepositoryActivity'

interface ActivityPanelProps {
  agentId?: string
  conversationId?: string
  loaded: boolean
  messages: AgentMessage[]
  busy: boolean
  run?: RunSnapshot
  onStop: () => Promise<void>
}

export default function ActivityPanel({ agentId, conversationId, loaded, messages, busy, run, onStop }: ActivityPanelProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const toggle = useRef<HTMLButtonElement>(null)

  if (!agentId || !conversationId || !loaded) return null

  return (
    <div className="workspace-chat-activity" onKeyDown={event => {
      if (event.key === 'Escape' && open && toggle.current?.getClientRects().length) {
        event.stopPropagation()
        setOpen(false)
        toggle.current.focus()
      }
    }}>
      <button ref={toggle} type="button" className="workspace-activity-toggle quiet-button"
        aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(current => !current)}>
        Activity
      </button>

      <aside id={panelId} className="workspace-activity-panel" aria-label="Chat activity">
        <RepositoryActivity key={JSON.stringify([agentId, conversationId])} agentId={agentId}
          conversationId={conversationId} busy={busy} stopping={run?.phase === 'stopping'} run={run} onStop={onStop}>
          <AttachedFiles messages={messages} />
        </RepositoryActivity>
      </aside>
    </div>
  )
}
