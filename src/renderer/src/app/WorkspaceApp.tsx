import '../styles/shell.css'
import '../styles/panes.css'
import '../styles/saved-chats.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Agent, Conversation, ConversationDetail } from '../../../shared/agent'
import type { Result, SavedConnection } from '../../../shared/chat'
import type { Section, SectionMode } from '../../../shared/organization'
import Header from '../components/Header'
import Workspace, { type LayoutUpdate } from '../components/panes/Workspace'
import { createPane, findPane, updatePane, type Rect } from '../components/panes/layout'
import { initialRegions, regionsMinimum, updateRegion, type RegionLayout } from '../components/panes/regions'
import type { DraftChatDestination, Tab } from '../components/panes/tabs'
import AgentExplorer, { AgentPicker } from '../features/organization/AgentExplorer'
import WorkspaceCreationDialog from '../features/organization/WorkspaceCreationDialog'
import type { ReadingPosition } from '../features/chat/SavedTranscript'
import WorkspaceChat, { type ComposerDraft } from '../features/chat/WorkspaceChat'
import Settings from '../features/connections/Settings'
import { findTab, openDraftChat, openSavedChat, updateChatTab } from './saved-chat-layout'
import { useSavedResource } from './useSavedResource'
import { chatKey, useWorkspaceChats, type ChatIdentity } from './useWorkspaceChats'

interface WorkspaceState {
  layout: RegionLayout
  nextPane: number
  focus?: { tabId: string; composer?: boolean }
}

type DraftState = ComposerDraft & { creating?: boolean; error?: string }

type Creation =
  | { kind: 'agent'; pickerId?: string }
  | { kind: 'section'; agentId: string }
  | { kind: 'project'; section: Section }

function nextGroup({ nextPane }: WorkspaceState) {
  return { id: `pane-${nextPane}`, title: `Group ${nextPane}` }
}

function withLayout(current: WorkspaceState, layout: RegionLayout) {
  if (layout === current.layout) return current
  const { id } = nextGroup(current)
  const created = layout.regions.some(region => region.layout && findPane(region.layout, id))
  return { ...current, layout, nextPane: current.nextPane + Number(created) }
}

function loadAgents() {
  return window.granite.agents.list()
}

function loadConnections() {
  return window.granite.connections.list()
}

const emptyDraft: DraftState = { text: '', attachments: [] }

export default function WorkspaceApp() {
  const [state, setState] = useState<WorkspaceState>(() => ({
    layout: updateRegion(initialRegions, 'content', null),
    nextPane: 2
  }))
  const [bounds, setBounds] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 })
  const [windowError, setWindowError] = useState('')
  const workspace = useRef<HTMLElement>(null)
  const positions = useRef(new Map<string, ReadingPosition>())
  const [drafts, setDrafts] = useState(new Map<string, DraftState>())
  const creatingDrafts = useRef(new Set<string>())
  const [explorerRevisions, setExplorerRevisions] = useState(new Map<string, number>())
  const [creation, setCreation] = useState<Creation>()
  const [selectedConnection, setSelectedConnection] = useState(() => localStorage.getItem('granite.connection') ?? '')
  const [editedConnections, setEditedConnections] = useState<SavedConnection[]>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settings = useRef<HTMLDialogElement>(null)
  const chatSession = useWorkspaceChats()
  const { result: agents, retry: retryAgents, update: updateAgents } = useSavedResource(loadAgents, 'Could not load your agents.')
  const { result: savedConnections, retry: retryConnections } = useSavedResource(loadConnections, 'Could not load your connections.')
  const connections = editedConnections ? { ok: true as const, value: editedConnections } : savedConnections
  const defaultConnection = connections?.ok
    ? (connections.value.find(item => item.id === selectedConnection) ?? connections.value[0])?.id ?? ''
    : ''
  const { layout, focus } = state
  const measured = bounds.width > 0 && bounds.height > 0
  const minimum = regionsMinimum(layout)
  const minWidth = Math.ceil(minimum.width + window.innerWidth - bounds.width)
  const minHeight = Math.ceil(minimum.height + window.innerHeight - bounds.height)

  useEffect(() => {
    if (!measured) return
    void window.granite.window.setMinimumSize(minWidth, minHeight).then(result => {
      setWindowError(result.ok ? '' : result.error)
    }).catch(() => setWindowError('Could not update the window minimum size.'))
  }, [minWidth, minHeight, measured])

  useLayoutEffect(() => {
    if (!focus) return
    const tab = document.getElementById(focus.tabId)
    if (!tab) return
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const input = focus.composer
      ? document.getElementById(tab.getAttribute('aria-controls')!)?.querySelector('textarea')
      : undefined
    const target = input && !input.disabled ? input : tab
    target.focus({ preventScroll: true })
  }, [focus])

  useLayoutEffect(() => {
    if (settingsOpen) settings.current?.showModal()
  }, [settingsOpen])

  useEffect(() => {
    const content = layout.regions.find(region => region.type === 'content')!.layout
    for (const viewId of positions.current.keys()) {
      if (!findTab(content, tab => tab.id === viewId)) positions.current.delete(viewId)
    }
    setDrafts(current => {
      const open = [...current].filter(([viewId]) => findTab(content, tab => tab.id === viewId))
      return open.length === current.size ? current : new Map(open)
    })
  }, [layout])

  useEffect(() => {
    const content = layout.regions.find(region => region.type === 'content')!.layout
    chatSession.prune(key => Boolean(findTab(content, tab =>
      tab.type === 'chat' && tab.conversation?.id !== undefined && chatKey(tab.conversation) === key
    )))
  }, [layout, chatSession.chats])

  function selectConnection(id: string) {
    setSelectedConnection(id)
    localStorage.setItem('granite.connection', id)
  }

  function clearDraft(id: string) {
    setDrafts(current => {
      if (!current.has(id)) return current
      const remaining = new Map(current)
      remaining.delete(id)
      return remaining
    })
  }

  function patchDraft(id: string, change: Partial<DraftState>) {
    setDrafts(current => new Map(current).set(id, { ...(current.get(id) ?? emptyDraft), ...change }))
  }

  function refreshExplorer(agentId: string) {
    setExplorerRevisions(current => new Map(current).set(agentId, (current.get(agentId) ?? 0) + 1))
  }

  function changeLayout(update: LayoutUpdate) {
    setState(current => withLayout(current, update(current.layout, nextGroup(current))))
  }

  function openChat(chat: Conversation, path: string[]) {
    setState(current => {
      const opened = openSavedChat(current.layout, nextGroup(current), chat, path)
      return { ...withLayout(current, opened.layout), focus: { tabId: opened.tabId } }
    })
    chatSession.load(chat)
  }

  function newChat(destination: DraftChatDestination) {
    setState(current => {
      const opened = openDraftChat(current.layout, nextGroup(current), destination)
      return { ...withLayout(current, opened.layout), focus: { tabId: opened.tabId, composer: true } }
    })
  }

  async function saveDraft(tabId: string, destination: DraftChatDestination): Promise<ConversationDetail | undefined> {
    if (creatingDrafts.current.has(tabId)) return
    creatingDrafts.current.add(tabId)
    patchDraft(tabId, { creating: true, error: '' })

    let error = ''
    try {
      const result = await window.granite.conversations.create(destination.agentId, destination.location)
      if (!result.ok) {
        error = result.error
        return
      }

      const { agentId, id, title } = result.value
      setState(current => withLayout(current, updateChatTab(current.layout, tab => tab.id === tabId, tab => ({
        ...tab,
        title,
        conversation: { agentId, id, path: destination.path }
      }))))
      refreshExplorer(agentId)
      return result.value
    } catch {
      error = 'Could not create this chat.'
    } finally {
      creatingDrafts.current.delete(tabId)
      setDrafts(current => {
        const draft = current.get(tabId)
        return draft ? new Map(current).set(tabId, { ...draft, creating: false, error }) : current
      })
    }
  }

  async function refreshNewChat(identity: ChatIdentity) {
    refreshExplorer(identity.agentId)
    const result = await window.granite.conversations.get(identity.agentId, identity.id).catch(() => undefined)
    // A metadata refresh can fail while the transcript is still streaming.
    if (!result?.ok) return
    const { title } = result.value
    chatSession.updateTitle(identity, title)
    setState(current => withLayout(current, updateChatTab(current.layout,
      tab => tab.conversation?.id === identity.id && tab.conversation.agentId === identity.agentId && tab.title !== title,
      tab => ({ ...tab, title })
    )))
  }

  function chooseAgent(agent: Agent, pickerId?: string) {
    setState(current => {
      const explorer = current.layout.regions.find(region => region.type === 'explorer')!.layout
      const entry = { type: 'agent' as const, agentId: agent.id, title: agent.name }
      if (!explorer) {
        const { id, title } = nextGroup(current)
        const pane = createPane(id, title, 'explorer', entry)
        const layout = updateRegion(current.layout, 'explorer', pane)
        return { ...withLayout(current, layout), focus: { tabId: pane.activeTabId } }
      }

      const picker = findTab(explorer, tab => tab.id === pickerId)
      if (!picker) return current
      const groups = updatePane(explorer, picker.pane.id, pane => ({
        ...pane,
        tabs: pane.tabs.map(tab => tab.id === picker.tab.id ? { ...entry, id: tab.id } : tab)
      }))
      const layout = updateRegion(current.layout, 'explorer', groups)
      return { ...withLayout(current, layout), focus: { tabId: picker.tab.id } }
    })
  }

  async function createEntry(action: Creation, name: string, mode: SectionMode): Promise<Result<unknown>> {
    if (action.kind === 'agent') {
      const result = await window.granite.agents.create(name)
      if (result.ok) {
        updateAgents(current => [...current, result.value])
        chooseAgent(result.value, action.pickerId)
      }
      return result
    }

    const api = window.granite.organization
    const result = action.kind === 'section'
      ? await api.createSection(action.agentId, name, mode)
      : await api.createProject(action.section.agentId, action.section.id, name)
    if (result.ok) refreshExplorer(result.value.agentId)
    return result
  }

  function renderExplorer(agentId?: string, pickerId?: string) {
    if (!agents) return <p className="pane-message" role="status">Loading agents…</p>
    if (!agents.ok) return (
      <div className="pane-message">
        <p role="alert">{agents.error}</p>
        <button type="button" onClick={retryAgents}>Retry</button>
      </div>
    )
    const agent = agents.value.find(item => item.id === agentId)
    if (agent) {
      return <AgentExplorer key={pickerId} agent={agent} revision={explorerRevisions.get(agent.id) ?? 0}
        onOpenChat={openChat} onNewChat={newChat}
        onNewSection={() => setCreation({ kind: 'section', agentId: agent.id })}
        onNewProject={section => setCreation({ kind: 'project', section })} />
    }

    return <AgentPicker key={pickerId} agents={agents.value} onChoose={chosen => chooseAgent(chosen, pickerId)}
      onNewAgent={() => setCreation({ kind: 'agent', pickerId })} />
  }

  function renderTab(tab: Tab) {
    if (tab.type === 'agent') return renderExplorer(tab.agentId, tab.id)
    if (tab.type === 'chat' && tab.conversation) {
      const conversation = tab.conversation
      const key = conversation.id !== undefined ? chatKey(conversation) : undefined
      const draft = drafts.get(tab.id) ?? emptyDraft
      const chat = key ? chatSession.chats.get(key) : { submitting: draft.creating, error: draft.error }
      const hasMessages = chat?.messages?.length ?? (chat?.result?.ok ? chat.result.value.messages.length : 0)
      const agent = agents?.ok ? agents.value.find(item => item.id === conversation.agentId) : undefined
      return (
        <WorkspaceChat
          key={tab.id}
          conversationId={conversation.id}
          agent={agent}
          path={conversation.path}
          chat={chat}
          connections={connections}
          selectedConnection={defaultConnection}
          draft={draft}
          onDraftChange={change => patchDraft(tab.id, change)}
          onDraftAccepted={() => clearDraft(tab.id)}
          onSelectConnection={selectConnection}
          onOpenSettings={() => setSettingsOpen(true)}
          onRetryConnections={retryConnections}
          onSubmit={async (connection, model, effort, text, intent, accepted) => {
            let saved: ChatIdentity
            if (conversation.id !== undefined) {
              saved = conversation
            } else {
              const created = await saveDraft(tab.id, conversation)
              if (!created) return
              chatSession.remember(created)
              saved = created
            }
            await chatSession.submit(saved, connection, model, effort, text, intent, () => {
              accepted()
              if (intent === 'message' && !hasMessages) void refreshNewChat(saved)
            })
          }}
          onError={error => key ? chatSession.setError(key, error) : patchDraft(tab.id, { error })}
          onReload={() => {
            if (conversation.id !== undefined) chatSession.load(conversation, true)
          }}
          readPosition={() => positions.current.get(tab.id)}
          savePosition={position => positions.current.set(tab.id, position)}
        />
      )
    }
    return null
  }

  return (
    <div className="app workspace-app">
      <Header />

      {windowError && <p role="alert">{windowError}</p>}

      <Workspace
        layout={layout}
        renderTab={renderTab}
        renderEmptyRegion={type => type === 'explorer' ? renderExplorer() : <p>Open or start a chat from Explorer.</p>}
        onLayoutChange={changeLayout}
        onBoundsChange={setBounds}
        newPane={nextGroup(state)}
        workspaceRef={workspace}
      />

      {creation && (
        <WorkspaceCreationDialog kind={creation.kind} sectionName={creation.kind === 'project' ? creation.section.name : undefined}
          onCreate={(name, mode) => createEntry(creation, name, mode)}
          onClose={() => setCreation(undefined)} />
      )}

      {settingsOpen && connections?.ok && (
        <dialog className="workspace-connections" aria-label="Connections" ref={settings} onClose={() => setSettingsOpen(false)}>
          <button type="button" className="quiet-button" onClick={() => settings.current?.close()}>
            Close settings
          </button>

          <Settings connections={connections.value} onChange={setEditedConnections} />
        </dialog>
      )}
    </div>
  )
}
