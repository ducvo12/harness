import { useCallback, useEffect, useState } from 'react'
import type { Agent, Conversation } from '../../../../../shared/agent'
import type { ConversationLocation, Project, Section } from '../../../../../shared/organization'
import { isWorkspaceMarkdown } from '../../../../../shared/workspace-markdown'
import { useSavedResource } from '../../../app/useSavedResource'
import Chevron from '../../Chevron'
import TreeActionIcon from '../../TreeActionIcon'
import type { DraftChatDestination, NewChatLocation } from '../layout/tabs'
import { defaultTreeSort, sortTreeEntries } from './tree-sort'

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

interface DraftEntry {
  id: string
  title: string
  location: ConversationLocation
}

interface AgentExplorerProps {
  agent: Agent
  revision: number
  onOpenFile: (path: string) => void
  onOpenChat: (chat: Conversation, path: string[]) => void
  drafts: DraftEntry[]
  onOpenDraft: (destination: DraftChatDestination) => void
  onNewChat: (destination: NewChatLocation) => void
  onNewSection: () => void
  onNewProject: (section: Section) => void
}

export default function AgentExplorer({ agent, revision, onOpenFile, onOpenChat, drafts, onOpenDraft, onNewChat, onNewSection, onNewProject }: AgentExplorerProps) {
  const agentId = agent.id
  const [fileRevision, setFileRevision] = useState(0)

  useEffect(() => {
    function refreshFiles() {
      setFileRevision(current => current + 1)
    }
    window.addEventListener('focus', refreshFiles)
    return () => window.removeEventListener('focus', refreshFiles)
  }, [])

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

  function chatLocation(section: Section, project?: Project): NewChatLocation {
    const path = [agent.name, section.name]
    if (project) path.push(project.name)
    return { agentId, path, location: { sectionId: section.id, projectId: project?.id ?? null } }
  }

  function draftRow(draft: DraftEntry, destination: NewChatLocation) {
    return (
      <button key={draft.id} type="button" className="tree-entry" title={draft.title}
        onClick={() => onOpenDraft({ ...destination, draftId: draft.id })}>
        <span>Draft · {draft.title}</span>
      </button>
    )
  }

  function draftsAt(section: Section, project?: Project) {
    return drafts.filter(draft =>
      draft.location.sectionId === section.id && draft.location.projectId === (project?.id ?? null))
  }

  const unavailableDrafts = drafts.filter(draft => !sections.some(section => section.id === draft.location.sectionId) ||
    (draft.location.projectId !== null && !projects.some(project => project.id === draft.location.projectId)))

  function newChatAction(section: Section, project?: Project) {
    const label = `New chat in ${project?.name ?? section.name}`
    return (
      <button type="button" className="agent-tree-new-chat tree-action" title={label} aria-label={label} onClick={event => {
        event.preventDefault()
        const folder = event.currentTarget.closest('details')
        if (folder) folder.open = true
        onNewChat(chatLocation(section, project))
      }}>
        <TreeActionIcon plus />
      </button>
    )
  }

  return (
    <div className="agent-explorer">
      <div className="agent-explorer-actions">
        {general && (
          <button type="button" className="new-chat-button quiet-button" aria-label="New chat" title="New chat in General" onClick={() => onNewChat(chatLocation(general))}>
            <span aria-hidden="true">+</span>New chat
          </button>
        )}

        <button type="button" className="quiet-button" onClick={onNewSection}>
          New section
        </button>
      </div>

      <WorkspaceFileTree agentId={agentId} revision={revision + fileRevision} path="/" onOpen={onOpenFile} />

      {unavailableDrafts.map(draft => draftRow(draft, {
        agentId, location: draft.location, path: [agent.name, 'Unavailable location']
      }))}

      {!sections.length && <p className="tree-empty">No saved sections.</p>}

      {sort(sections).map(section => {
        const children = sort([
          ...chats.filter(chat => chat.sectionId === section.id && chat.projectId === null),
          ...projects.filter(project => project.sectionId === section.id)
        ])

        const sectionDrafts = draftsAt(section)
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

              {sectionDrafts.map(draft => draftRow(draft, chatLocation(section)))}

              {!children.length && !sectionDrafts.length && <p className="tree-empty">No saved chats.</p>}

              {children.map(child => {
                if ('title' in child) return chatRow(child, [agent.name, section.name])
                const projectChats = sort(chats.filter(chat => chat.projectId === child.id))
                const projectDrafts = draftsAt(section, child)
                return (
                  <details key={child.id}>
                    <summary>
                      {child.name}
                      {newChatAction(section, child)}
                    </summary>

                    <div className="agent-tree-children">
                      {projectDrafts.map(draft => draftRow(draft, chatLocation(section, child)))}

                      {!projectChats.length && !projectDrafts.length && <p className="tree-empty">No saved chats.</p>}

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

interface WorkspaceFileTreeProps {
  agentId: string
  path: string
  revision: number
  onOpen: (path: string) => void
}

function WorkspaceFileTree({ agentId, path, revision, onOpen }: WorkspaceFileTreeProps) {
  const root = path === '/'
  const load = useCallback(() => window.granite.workspace.entries(agentId, path), [agentId, path])
  const { result, retry } = useSavedResource(load, 'Could not load workspace files.', revision)
  // The root also contains Granite's internal storage directories.
  const entries = result?.ok ? result.value.filter(entry =>
    entry.directory ? !root || entry.path === '/notes/' : isWorkspaceMarkdown(entry.path)
  ) : []

  if (root) entries.sort((first, second) => Number(first.directory) - Number(second.directory))

  return (
    <div className={root ? 'agent-markdown-files' : 'organization-children'}>
      {!result && <p className="tree-empty" role="status">Loading files…</p>}

      {result?.ok === false && (
        <div className="tree-empty" role="alert">
          {result.error}
          <button type="button" className="quiet-button" onClick={retry}>Retry</button>
        </div>
      )}

      {!root && result?.ok && entries.length === 0 && <p className="tree-empty">No notes yet</p>}

      {entries.map(entry => {
        if (entry.directory) {
          return <WorkspaceFileFolder key={entry.path} agentId={agentId} path={entry.path} revision={revision} onOpen={onOpen} />
        }

        return (
          <button key={entry.path} type="button" className="tree-entry tree-file"
            title={root ? entry.path.slice(1) : entry.path} onClick={() => onOpen(entry.path)}>
            <span className="tree-file-icon" aria-hidden="true">▤</span>
            <span>{entry.path.split('/').at(-1)}</span>
          </button>
        )
      })}
    </div>
  )
}

function WorkspaceFileFolder(props: WorkspaceFileTreeProps) {
  const [open, setOpen] = useState(false)
  const name = props.path.split('/').filter(Boolean).at(-1)

  return (
    <div className="notes-tree">
      <div className="tree-row">
        <button type="button" className="tree-entry" aria-expanded={open} onClick={() => setOpen(current => !current)}>
          <span className="tree-chevron" aria-hidden="true"><Chevron expanded={open} /></span>
          <span>{name}/</span>
        </button>
      </div>

      {open && <WorkspaceFileTree {...props} />}
    </div>
  )
}
