import type { AgentMessage } from '../../../../shared/agent'
import type { RunSnapshot } from '../../../../shared/run'
import type { ChatAttachment } from './attachments'
import RepositoryActivity from './RepositoryActivity'
import ProjectActivity from './ProjectActivity'
import AttachedFiles from './AttachedFiles'
import ActivitySection from './ActivitySection'
import ContextActivity from './ContextActivity'

export default function ActivityPanel({ agentId, conversationId, repository, busy, stopping, run, messages, attachments, disabled, onAttachmentsChange, onStop }: {
  agentId: string; conversationId: string; repository: boolean; busy: boolean; stopping: boolean
  run?: RunSnapshot; messages: AgentMessage[]; attachments: ChatAttachment[]; disabled: boolean
  onAttachmentsChange: (files: ChatAttachment[]) => void
  onStop: () => Promise<void>
}) {
  return (
    <aside id="chat-activity-panel" className="chat-activity-panel" aria-label="Chat activity">
      <div className="activity-panel-body">
        <RepositoryActivity agentId={agentId} conversationId={conversationId} busy={busy} stopping={stopping} run={run} onStop={onStop}>
          <ContextActivity agentId={agentId} chatId={conversationId} messages={messages} />

          <AttachedFiles key={`${agentId}:${conversationId}`} attachments={attachments} messages={messages} disabled={disabled} onChange={onAttachmentsChange} />
        </RepositoryActivity>

        {repository && agentId && conversationId ? <ProjectActivity agentId={agentId} chatId={conversationId} busy={busy} />
          : <ActivitySection title="Running apps" summary={<span className="activity-count">0</span>} />}
      </div>
    </aside>
  )
}
