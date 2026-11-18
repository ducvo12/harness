import type { Conversation } from '../../../shared/agent.ts'
import { createPane, updatePane, type Layout, type PaneNode } from '../components/workspace/layout/layout.ts'
import { updateRegion, type RegionLayout } from '../components/workspace/layout/regions.ts'
import { addTab, selectTab, type DraftChatDestination, type FileDestination, type NewTab, type Tab } from '../components/workspace/layout/tabs.ts'

export function findTab(layout: Layout | null, matches: (tab: Tab) => boolean): { pane: PaneNode; tab: Tab } | undefined {
  if (!layout) return
  if (layout.kind === 'split') return findTab(layout.first, matches) ?? findTab(layout.second, matches)
  const tab = layout.tabs.find(matches)
  if (tab) return { pane: layout, tab }
}

export function openSavedChat(layout: RegionLayout, identity: Pick<PaneNode, 'id' | 'title'>, chat: Conversation, path: string[]) {
  return openContentTab(layout, identity,
    { type: 'chat', title: chat.title, conversation: { agentId: chat.agentId, id: chat.id, path } },
    tab => tab.type === 'chat' && tab.conversation?.agentId === chat.agentId && tab.conversation.id === chat.id
  )
}

export function openWorkspaceFile(layout: RegionLayout, identity: Pick<PaneNode, 'id' | 'title'>, file: FileDestination) {
  return openContentTab(layout, identity,
    { type: 'file', title: file.path.slice(file.path.lastIndexOf('/') + 1), file },
    tab => tab.type === 'file' && tab.file?.agentId === file.agentId && tab.file.path === file.path
  )
}

function openContentTab(
  layout: RegionLayout,
  identity: Pick<PaneNode, 'id' | 'title'>,
  tab: Extract<NewTab, { type: 'chat' | 'file' }>,
  matches: (tab: Tab) => boolean
) {
  const content = layout.regions.find(region => region.type === 'content')!.layout
  const existing = findTab(content, matches)
  if (existing && content) {
    const selected = updatePane(content, existing.pane.id, pane => selectTab(pane, existing.tab.id))
    return { layout: updateRegion(layout, 'content', selected), tabId: existing.tab.id }
  }

  return addContentTab(layout, identity, tab)
}

export function openDraftChat(layout: RegionLayout, identity: Pick<PaneNode, 'id' | 'title'>, destination: DraftChatDestination) {
  return openContentTab(layout, identity, { type: 'chat', title: 'New chat', conversation: destination },
    tab => tab.type === 'chat' && tab.conversation?.draftId === destination.draftId
  )
}

function addContentTab(layout: RegionLayout, identity: Pick<PaneNode, 'id' | 'title'>, tab: NewTab) {
  const content = layout.regions.find(region => region.type === 'content')!.layout
  let target = content
  while (target?.kind === 'split') target = target.first
  if (!target || !content) {
    const pane = createPane(identity.id, identity.title, 'content', tab)
    return { layout: updateRegion(layout, 'content', pane), tabId: pane.activeTabId }
  }

  const pane = addTab(target, tab)
  return {
    layout: updateRegion(layout, 'content', updatePane(content, target.id, () => pane)),
    tabId: pane.activeTabId
  }
}

export function updateChatTab(
  layout: RegionLayout,
  matches: (tab: Extract<Tab, { type: 'chat' }>) => boolean,
  update: (tab: Extract<Tab, { type: 'chat' }>) => Extract<Tab, { type: 'chat' }>
) {
  const content = layout.regions.find(region => region.type === 'content')!.layout
  if (!content) return layout
  const found = findTab(content, tab => tab.type === 'chat' && matches(tab))
  if (!found) return layout

  return updateRegion(layout, 'content', updatePane(content, found.pane.id, pane => ({
    ...pane,
    tabs: pane.tabs.map(tab => tab.type === 'chat' && tab.id === found.tab.id ? update(tab) : tab)
  })))
}
