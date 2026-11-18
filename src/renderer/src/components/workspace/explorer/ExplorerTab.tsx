import type { Agent, Conversation } from '../../../../../shared/agent'
import type { Result } from '../../../../../shared/chat'
import type { Section } from '../../../../../shared/organization'
import type { ChatDraft } from '../../../app/useChatDrafts'
import type { DraftChatDestination, FileDestination, NewChatLocation } from '../layout/tabs'
import AgentExplorer, { AgentPicker } from './AgentExplorer'

export interface ExplorerTabProps {
  agentId?: string
  tabId?: string
  agents?: Result<Agent[]>
  drafts: ReadonlyMap<string, ChatDraft>
  revisions: ReadonlyMap<string, number>
  onRetryAgents: () => void
  onChooseAgent: (agent: Agent, tabId?: string) => void
  onNewAgent: (tabId?: string) => void
  onOpenDraft: (destination: DraftChatDestination) => void
  onOpenFile: (file: FileDestination) => void
  onOpenChat: (chat: Conversation, path: string[]) => void
  onNewChat: (destination: NewChatLocation) => void
  onNewSection: (agentId: string) => void
  onNewProject: (section: Section) => void
}

export default function ExplorerTab({
  agentId, tabId, agents, drafts, revisions, onRetryAgents, onChooseAgent, onNewAgent,
  onOpenDraft, onOpenFile, onOpenChat, onNewChat, onNewSection, onNewProject
}: ExplorerTabProps) {
  if (!agents) {
    return (
      <p className="pane-message" role="status">
        Loading agents…
      </p>
    )
  }

  if (!agents.ok) {
    return (
      <div className="pane-message">
        <p role="alert">{agents.error}</p>

        <button type="button" onClick={onRetryAgents}>
          Retry
        </button>
      </div>
    )
  }

  const agent = agents.value.find(item => item.id === agentId)
  if (!agent) {
    return (
      <AgentPicker
        agents={agents.value}
        onChoose={chosen => onChooseAgent(chosen, tabId)}
        onNewAgent={() => onNewAgent(tabId)}
      />
    )
  }

  const agentDrafts = [...drafts.values()].flatMap(draft => {
    if (draft.agentId !== agent.id || !draft.location) return []

    return [{
      id: draft.id,
      location: draft.location,
      title: draft.text.trim().split('\n', 1)[0].slice(0, 64) ||
        draft.attachments[0]?.name || 'New chat'
    }]
  })

  return (
    <AgentExplorer
      agent={agent}
      revision={revisions.get(agent.id) ?? 0}
      drafts={agentDrafts}
      onOpenDraft={onOpenDraft}
      onOpenFile={path => onOpenFile({ agentId: agent.id, path })}
      onOpenChat={onOpenChat}
      onNewChat={onNewChat}
      onNewSection={() => onNewSection(agent.id)}
      onNewProject={onNewProject}
    />
  )
}
