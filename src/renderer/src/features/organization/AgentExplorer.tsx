import { useCallback } from 'react'
import type { Agent, Conversation } from '../../../../shared/agent'
import type { Project, Section } from '../../../../shared/organization'
import { defaultTreeSort, sortTreeEntries } from '../../app/tree-sort'
import { useSavedResource } from '../../app/useSavedResource'

export function AgentPicker({ agents, onChoose }: { agents: Agent[]; onChoose: (agent: Agent) => void }) {
  return (
    <div className="agent-explorer" role="group" aria-label="Choose an agent">
      {agents.length === 0 && <p>No saved agents.</p>}

      {agents.map(agent => (
        <button type="button" className="tree-entry" key={agent.id} onClick={() => onChoose(agent)}>
          <span>{agent.name}</span>
        </button>
      ))}
    </div>
  )
}

interface AgentExplorerProps {
  agent: Agent
  onOpenChat: (chat: Conversation, path: string[]) => void
}

export default function AgentExplorer({ agent, onOpenChat }: AgentExplorerProps) {
  const agentId = agent.id
  const load = useCallback(async () => {
    const [organization, conversations] = await Promise.all([
      window.granite.organization.get(agentId),
      window.granite.conversations.list(agentId)
    ])
    if (!organization.ok) return organization
    if (!conversations.ok) return conversations
    return { ok: true as const, value: { ...organization.value, chats: conversations.value } }
  }, [agentId])
  const { result, retry } = useSavedResource(load, 'Could not load this agent’s chats.')

  if (!result) return <p className="pane-message" role="status">Loading chats…</p>
  if (!result.ok) return (
    <div className="pane-message">
      <p role="alert">{result.error}</p>
      <button type="button" onClick={retry}>Retry</button>
    </div>
  )

  const { sections, projects, chats } = result.value
  const sort = <T extends Conversation | Project | Section>(entries: T[]) =>
    sortTreeEntries(entries, chats, defaultTreeSort)

  function chatRow(chat: Conversation, path: string[]) {
    return (
      <button key={chat.id} type="button" className="tree-entry" title={chat.title} onClick={() => onOpenChat(chat, path)}>
        <span>{chat.title}</span>
      </button>
    )
  }

  return (
    <div className="agent-explorer">
      {!sections.length && <p className="tree-empty">No saved sections.</p>}

      {sort(sections).map(section => {
        const children = sort([
          ...chats.filter(chat => chat.sectionId === section.id && chat.projectId === null),
          ...projects.filter(project => project.sectionId === section.id)
        ])

        return (
          <details key={section.id} open>
            <summary>{section.name}</summary>

            <div className="agent-tree-children">
              {!children.length && <p className="tree-empty">No saved chats.</p>}

              {children.map(child => {
                if ('title' in child) return chatRow(child, [agent.name, section.name])
                const projectChats = sort(chats.filter(chat => chat.projectId === child.id))
                return (
                  <details key={child.id}>
                    <summary>{child.name}</summary>

                    <div className="agent-tree-children">
                      {!projectChats.length && <p className="tree-empty">No saved chats.</p>}

                      {projectChats.map(chat => chatRow(chat, [agent.name, section.name, child.name]))}
                    </div>
                  </details>
                )
              })}
            </div>
          </details>
        )
      })}
    </div>
  )
}
