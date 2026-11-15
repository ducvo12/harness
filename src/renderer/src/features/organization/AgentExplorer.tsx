import { useCallback } from 'react'
import type { Agent, Conversation } from '../../../../shared/agent'
import type { Project, Section } from '../../../../shared/organization'
import { defaultTreeSort, sortTreeEntries } from '../../app/tree-sort'
import { useSavedResource } from '../../app/useSavedResource'
import type { DraftChatDestination } from '../../components/panes/tabs'
import TreeActionIcon from '../../components/TreeActionIcon'
import AgentMarkdownFiles from '../workspace/AgentMarkdownFiles'

export function AgentPicker({ agents, onChoose, onNewAgent }: {
  agents: Agent[]
  onChoose: (agent: Agent) => void
  onNewAgent: () => void
}) {
  return (
    <div className="agent-explorer" role="group" aria-label="Choose an agent">
      <button type="button" className="agent-picker-create quiet-button" onClick={onNewAgent}>
        New agent
      </button>

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
  revision: number
  onOpenFile: (path: string) => void
  onOpenChat: (chat: Conversation, path: string[]) => void
  onNewChat: (destination: DraftChatDestination) => void
  onNewSection: () => void
  onNewProject: (section: Section) => void
}

export default function AgentExplorer({ agent, revision, onOpenFile, onOpenChat, onNewChat, onNewSection, onNewProject }: AgentExplorerProps) {
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
  const { result, retry } = useSavedResource(load, 'Could not load this agent’s Explorer.', revision)

  if (!result) return <p className="pane-message" role="status">Loading chats…</p>
  if (!result.ok) return (
    <div className="pane-message">
      <p role="alert">{result.error}</p>
      <button type="button" onClick={retry}>Retry</button>
    </div>
  )

  const { sections, projects, chats } = result.value
  const general = sections.find(section => section.kind === 'general')
  const sort = <T extends Conversation | Project | Section>(entries: T[]) =>
    sortTreeEntries(entries, chats, defaultTreeSort)

  function chatRow(chat: Conversation, path: string[]) {
    return (
      <button key={chat.id} type="button" className="tree-entry" title={chat.title} onClick={() => onOpenChat(chat, path)}>
        <span>{chat.title}</span>
      </button>
    )
  }

  function startChat(section: Section, project?: Project) {
    const path = [agent.name, section.name]
    if (project) path.push(project.name)
    onNewChat({ agentId, path, location: { sectionId: section.id, projectId: project?.id ?? null } })
  }

  function newChatAction(section: Section, project?: Project) {
    const label = `New chat in ${project?.name ?? section.name}`
    return (
      <button type="button" className="agent-tree-new-chat tree-action" title={label} aria-label={label} onClick={event => {
        event.preventDefault()
        const folder = event.currentTarget.closest('details')
        if (folder) folder.open = true
        startChat(section, project)
      }}>
        <TreeActionIcon plus />
      </button>
    )
  }

  return (
    <div className="agent-explorer">
      <div className="agent-explorer-actions">
        {general && (
          <button type="button" className="new-chat-button quiet-button" aria-label="New chat" title="New chat in General" onClick={() => startChat(general)}>
            <span aria-hidden="true">+</span>New chat
          </button>
        )}

        <button type="button" className="quiet-button" onClick={onNewSection}>
          New section
        </button>
      </div>

      <AgentMarkdownFiles agentId={agentId} revision={revision} onOpen={onOpenFile} />

      {!sections.length && <p className="tree-empty">No saved sections.</p>}

      {sort(sections).map(section => {
        const children = sort([
          ...chats.filter(chat => chat.sectionId === section.id && chat.projectId === null),
          ...projects.filter(project => project.sectionId === section.id)
        ])

        return (
          <details key={section.id} open>
            <summary>
              {section.name}
              {section.kind !== 'general' && newChatAction(section)}
            </summary>

            <div className="agent-tree-children">
              {section.kind === 'custom' && (
                <button type="button" className="tree-entry" aria-label={`New project in ${section.name}`} onClick={() => onNewProject(section)}>
                  <TreeActionIcon plus />
                  <span>New project</span>
                </button>
              )}

              {!children.length && <p className="tree-empty">No saved chats.</p>}

              {children.map(child => {
                if ('title' in child) return chatRow(child, [agent.name, section.name])
                const projectChats = sort(chats.filter(chat => chat.projectId === child.id))
                return (
                  <details key={child.id}>
                    <summary>
                      {child.name}
                      {newChatAction(section, child)}
                    </summary>

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
