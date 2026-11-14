import '../styles/shell.css'
import '../styles/panes.css'
import '../styles/saved-chats.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Agent, Conversation, ConversationDetail } from '../../../shared/agent'
import type { Result } from '../../../shared/chat'
import Header from '../components/Header'
import Workspace, { type LayoutUpdate } from '../components/panes/Workspace'
import { createPane, findPane, updatePane, type Rect } from '../components/panes/layout'
import { initialRegions, regionsMinimum, updateRegion, type RegionLayout } from '../components/panes/regions'
import type { Tab } from '../components/panes/tabs'
import AgentExplorer, { AgentPicker } from '../features/organization/AgentExplorer'
import SavedTranscript, { type ReadingPosition } from '../features/chat/SavedTranscript'
import { findTab, openSavedChat } from './saved-chat-layout'
import { useSavedResource } from './useSavedResource'

interface WorkspaceState {
  layout: RegionLayout
  nextPane: number
  focus?: { tabId: string }
}

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

function conversationKey(agentId: string, chatId: string) {
  return JSON.stringify([agentId, chatId])
}

export default function WorkspaceApp() {
  const [state, setState] = useState<WorkspaceState>(() => ({
    layout: updateRegion(initialRegions, 'content', null),
    nextPane: 2
  }))
  const [bounds, setBounds] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 })
  const [windowError, setWindowError] = useState('')
  const workspace = useRef<HTMLElement>(null)
  const positions = useRef(new Map<string, ReadingPosition>())
  const requests = useRef(new Map<string, Promise<Result<ConversationDetail>>>())
  const [transcripts, setTranscripts] = useState(() => new Map<string, Result<ConversationDetail>>())
  const { result: agents, retry: retryAgents } = useSavedResource(loadAgents, 'Could not load your agents.')
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
    tab?.focus({ preventScroll: true })
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [focus])

  useEffect(() => {
    const content = layout.regions.find(region => region.type === 'content')!.layout
    for (const viewId of positions.current.keys()) {
      if (!findTab(content, tab => tab.id === viewId)) positions.current.delete(viewId)
    }
    const stillOpen = (key: string) => findTab(content, tab => tab.type === 'chat' && tab.conversation !== undefined &&
      conversationKey(tab.conversation.agentId, tab.conversation.id) === key)
    const closed = [...requests.current.keys()].filter(key => !stillOpen(key))
    if (closed.length) {
      for (const key of closed) requests.current.delete(key)
      setTranscripts(current => {
        const remaining = new Map(current)
        for (const key of closed) remaining.delete(key)
        return remaining
      })
    }
  }, [layout])

  function loadChat(agentId: string, chatId: string, retry = false) {
    const key = conversationKey(agentId, chatId)
    if (retry) {
      requests.current.delete(key)
      setTranscripts(current => {
        const pending = new Map(current)
        pending.delete(key)
        return pending
      })
    }
    if (requests.current.has(key)) return

    const request = window.granite.conversations.get(agentId, chatId)
    requests.current.set(key, request)
    function publish(result: Result<ConversationDetail>) {
      if (requests.current.get(key) === request) {
        setTranscripts(current => new Map(current).set(key, result))
      }
    }
    void request.then(publish, () => publish({ ok: false, error: 'Could not load this conversation.' }))
  }

  function changeLayout(update: LayoutUpdate) {
    setState(current => withLayout(current, update(current.layout, nextGroup(current))))
  }

  function openChat(chat: Conversation, path: string[]) {
    setState(current => {
      const opened = openSavedChat(current.layout, nextGroup(current), chat, path)
      return { ...withLayout(current, opened.layout), focus: { tabId: opened.tabId } }
    })
    loadChat(chat.agentId, chat.id)
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

  function renderExplorer(agentId?: string, pickerId?: string) {
    if (!agents) return <p className="pane-message" role="status">Loading agents…</p>
    if (!agents.ok) return (
      <div className="pane-message">
        <p role="alert">{agents.error}</p>
        <button type="button" onClick={retryAgents}>Retry</button>
      </div>
    )
    const agent = agents.value.find(item => item.id === agentId)
    return agent
      ? <AgentExplorer key={pickerId} agent={agent} onOpenChat={openChat} />
      : <AgentPicker key={pickerId} agents={agents.value} onChoose={chosen => chooseAgent(chosen, pickerId)} />
  }

  function renderTab(tab: Tab) {
    if (tab.type === 'agent') return renderExplorer(tab.agentId, tab.id)
    if (tab.type === 'chat' && tab.conversation) {
      const { agentId, id, path } = tab.conversation
      return (
        <SavedTranscript
          key={tab.id}
          path={path}
          result={transcripts.get(conversationKey(agentId, id))}
          retry={() => loadChat(agentId, id, true)}
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
        renderEmptyRegion={type => type === 'explorer' ? renderExplorer() : <p>Open a saved chat from Explorer.</p>}
        onLayoutChange={changeLayout}
        onBoundsChange={setBounds}
        newPane={nextGroup(state)}
        workspaceRef={workspace}
      />
    </div>
  )
}
