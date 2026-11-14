import type { Conversation } from '../../../shared/agent.ts'
import { createPane, updatePane, type Layout, type PaneNode } from '../components/panes/layout.ts'
import { updateRegion, type RegionLayout } from '../components/panes/regions.ts'
import { addTab, selectTab, type Tab } from '../components/panes/tabs.ts'

export function findTab(layout: Layout | null, matches: (tab: Tab) => boolean): { pane: PaneNode; tab: Tab } | undefined {
  if (!layout) return
  if (layout.kind === 'split') return findTab(layout.first, matches) ?? findTab(layout.second, matches)
  const tab = layout.tabs.find(matches)
  if (tab) return { pane: layout, tab }
}

export function openSavedChat(layout: RegionLayout, identity: Pick<PaneNode, 'id' | 'title'>, chat: Conversation, path: string[]) {
  const content = layout.regions.find(region => region.type === 'content')!.layout
  const existing = findTab(content, tab =>
    tab.type === 'chat' && tab.conversation?.agentId === chat.agentId && tab.conversation.id === chat.id
  )
  if (existing && content) {
    const selected = updatePane(content, existing.pane.id, pane => selectTab(pane, existing.tab.id))
    return { layout: updateRegion(layout, 'content', selected), tabId: existing.tab.id }
  }

  let target = content
  while (target?.kind === 'split') target = target.first

  const tab = { type: 'chat' as const, title: chat.title, conversation: { agentId: chat.agentId, id: chat.id, path } }
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
