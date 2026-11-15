import { z } from 'zod/mini'
import type { Agent } from '../../../shared/agent.ts'
import type { GraniteBridge } from '../../../shared/chat.ts'
import { isWorkspaceMarkdown } from '../../../shared/workspace-markdown.ts'
import type { Layout, PaneNode } from '../components/panes/layout.ts'
import { acceptsTab } from '../components/panes/pane-types.ts'
import { initialRegions, updateRegion, type RegionLayout } from '../components/panes/regions.ts'
import type { Tab } from '../components/panes/tabs.ts'

export interface SavedWorkspaceLayout {
  layout: RegionLayout
  nextPane: number
}

const storageKey = 'granite.workspace.layout'
const paneId = /^pane-([1-9]\d*)$/
const tabId = /^(pane-[1-9]\d*)-tab-([1-9]\d*)$/
const counter = z.int().check(z.positive())
const ratio = z.number().check(z.gt(0), z.lt(1))
const paneType = z.enum(['explorer', 'content'])
const agentId = z.string().check(z.regex(/^[a-z][a-z0-9-]{0,63}$/))
const tabFields = { id: z.string().check(z.regex(tabId)), title: z.string() }
const tab = z.discriminatedUnion('type', [
  z.object({ ...tabFields, type: z.literal('agent'), agentId: z.optional(agentId) }),
  z.object({
    ...tabFields,
    type: z.literal('chat'),
    conversation: z.object({ agentId, id: z.string().check(z.minLength(1), z.maxLength(100)), path: z.array(z.string()) })
  }),
  z.object({
    ...tabFields,
    type: z.literal('file'),
    file: z.object({ agentId, path: z.string().check(z.maxLength(1024), z.refine(isWorkspaceMarkdown)) })
  })
])
const tree: z.ZodMiniType<Layout> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pane'),
    id: z.string().check(z.regex(paneId)),
    title: z.string(),
    paneType,
    tabs: z.array(tab).check(z.minLength(1)),
    activeTabId: z.string(),
    nextTab: counter
  }),
  z.object({
    kind: z.literal('split'),
    axis: z.enum(['horizontal', 'vertical']),
    ratio,
    first: tree,
    second: tree
  })
]))
const region = z.object({ type: paneType, layout: z.nullable(tree) })
const snapshot = z.object({
  version: z.literal(1),
  layout: z.object({ regions: z.tuple([region, region]), ratio }),
  nextPane: counter
})

function* panes(node: Layout | null): Generator<PaneNode> {
  if (!node) return
  if (node.kind === 'pane') yield node
  else {
    yield* panes(node.first)
    yield* panes(node.second)
  }
}

export function workspacePanes(layout: RegionLayout) {
  return layout.regions.flatMap(region => [...panes(region.layout)])
}

function validLayout({ layout, nextPane }: SavedWorkspaceLayout) {
  if (layout.regions[0].type === layout.regions[1].type) return false

  const paneCounters = new Map<string, number>()
  const tabIds = new Set<string>()
  for (const region of layout.regions) {
    for (const pane of panes(region.layout)) {
      if (pane.paneType !== region.type || paneCounters.has(pane.id) || Number(pane.id.slice(5)) >= nextPane) return false
      if (!pane.tabs.some(tab => tab.id === pane.activeTabId)) return false
      paneCounters.set(pane.id, pane.nextTab)
    }
  }

  for (const pane of workspacePanes(layout)) {
    for (const tab of pane.tabs) {
      // Docked tabs keep the ID of their original pane, even after it closes.
      const [, origin, number] = tabId.exec(tab.id)!
      if (tabIds.has(tab.id) || !acceptsTab(pane.paneType, tab.type) || Number(origin.slice(5)) >= nextPane ||
          !Number.isSafeInteger(Number(number)) || Number(number) >= (paneCounters.get(origin) ?? Infinity)) return false
      tabIds.add(tab.id)
    }
  }

  return true
}

function filterTree(node: Layout | null, keep: (tab: Tab) => boolean): Layout | null {
  if (!node) return null
  if (node.kind === 'split') {
    const first = filterTree(node.first, keep)
    const second = filterTree(node.second, keep)
    if (!first || !second) return first ?? second
    return first === node.first && second === node.second ? node : { ...node, first, second }
  }

  const tabs = node.tabs.filter(keep)
  if (!tabs.length) return null
  if (tabs.length === node.tabs.length) return node
  const active = tabs.find(tab => tab.id === node.activeTabId) ?? tabs[0]
  return { ...node, tabs, activeTabId: active.id }
}

export function filterWorkspaceTabs(layout: RegionLayout, keep: (tab: Tab) => boolean) {
  let result = layout
  for (const region of layout.regions) {
    const filtered = filterTree(region.layout, keep)
    if (filtered !== region.layout) result = updateRegion(result, region.type, filtered)
  }
  return result
}

export function loadWorkspaceLayout(): SavedWorkspaceLayout {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const result = snapshot.safeParse(JSON.parse(raw))
      if (result.success && validLayout(result.data)) {
        const { layout, nextPane } = result.data
        return { layout, nextPane }
      }
    }
  } catch {
    // A malformed snapshot or unavailable storage should still let Granite open.
  }
  return { layout: updateRegion(initialRegions, 'content', null), nextPane: 2 }
}

export function saveWorkspaceLayout({ layout, nextPane }: SavedWorkspaceLayout) {
  const saved = filterWorkspaceTabs(layout, tab =>
    tab.type === 'agent' || (tab.type === 'chat' && tab.conversation?.id !== undefined) ||
    (tab.type === 'file' && tab.file !== undefined && isWorkspaceMarkdown(tab.file.path))
  )
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, layout: saved, nextPane }))
  } catch {
    // Keep the current layout usable if the profile cannot store the snapshot.
  }
}

export async function findMissingWorkspaceTabs(
  layout: RegionLayout,
  agents: Agent[],
  api: Pick<GraniteBridge, 'conversations' | 'workspace'>
) {
  const available = new Set(agents.map(agent => agent.id))
  const lists = new Map<string, Promise<Set<string> | undefined>>()

  function savedChats(agentId: string) {
    let list = lists.get(agentId)
    if (!list) {
      list = api.conversations.list(agentId).then(result =>
        result.ok ? new Set(result.value.map(chat => chat.id)) : undefined,
        () => undefined
      )
      lists.set(agentId, list)
    }
    return list
  }

  const tabs = workspacePanes(layout).flatMap(pane => pane.tabs)
  const missing = await Promise.all(tabs.map(async tab => {
    if (tab.type === 'agent') return tab.agentId && !available.has(tab.agentId) ? tab.id : undefined
    if (tab.type === 'chat' && tab.conversation?.id !== undefined) {
      const { agentId, id } = tab.conversation
      if (!available.has(agentId)) return tab.id
      const chats = await savedChats(agentId)
      if (chats && !chats.has(id)) return tab.id
    }
    if (tab.type === 'file' && tab.file) {
      const { agentId, path } = tab.file
      if (!available.has(agentId)) return tab.id
      const result = await api.workspace.read(agentId, path).catch(() => undefined)
      if (result?.ok === false && result.code === 'not_found') return tab.id
    }
  }))
  return new Set(missing.filter(id => id !== undefined))
}
