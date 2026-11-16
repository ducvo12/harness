import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Conversation } from '../src/shared/agent.ts'
import { findTab, openSavedChat } from '../src/renderer/src/app/saved-chat-layout.ts'
import { dockTab, removePane, type Layout } from '../src/renderer/src/components/panes/layout.ts'
import { initialRegions, updateRegion, type RegionLayout } from '../src/renderer/src/components/panes/regions.ts'

const chat: Conversation = {
  id: 'saved', agentId: 'atlas', title: 'Saved chat', sectionId: 'general', projectId: null,
  createdAt: 1, updatedAt: 1, lastChattedAt: 1, retention: 'permanent', expiresAt: null
}
const group = { id: 'pane-2', title: 'Group 2' }

function content(layout: RegionLayout): Layout {
  const groups = layout.regions.find(region => region.type === 'content')!.layout
  assert.ok(groups)
  return groups
}

test('opening from an empty Content region creates one view and repeated opens focus it', () => {
  const empty = updateRegion(initialRegions, 'content', null)
  const first = openSavedChat(empty, group, chat, ['Atlas', 'General'])
  const again = openSavedChat(first.layout, { id: 'pane-3', title: 'Group 3' }, chat, ['Atlas', 'General'])

  assert.equal(again.tabId, first.tabId)
  const pane = content(again.layout)
  assert.equal(pane.kind, 'pane')
  assert.deepEqual(pane.tabs, [{
    id: first.tabId,
    title: 'Saved chat',
    type: 'chat',
    conversation: { agentId: 'atlas', id: 'saved', path: ['Atlas', 'General'] }
  }])

  const reopened = openSavedChat(updateRegion(again.layout, 'content', removePane(pane, group.id)),
    { id: 'pane-3', title: 'Group 3' }, chat, ['Atlas', 'General'])
  assert.notEqual(reopened.tabId, first.tabId)
})

test('same-title chats stay distinct and reopening selects the original view after docking', () => {
  const empty = updateRegion(initialRegions, 'content', null)
  const first = openSavedChat(empty, group, chat, ['Atlas', 'General'])
  const second = openSavedChat(first.layout, group, { ...chat, agentId: 'other' }, ['Other', 'General'])
  assert.notEqual(second.tabId, first.tabId)

  const split = dockTab(content(second.layout), group.id, first.tabId, { id: 'pane-3', title: 'Group 3' },
    { paneId: group.id, edge: 'right' })
  const opened = openSavedChat(updateRegion(second.layout, 'content', split), group, chat, ['Atlas', 'General'])
  assert.equal(opened.tabId, first.tabId)
  assert.equal(findTab(content(opened.layout), tab => tab.id === first.tabId)?.pane.id, 'pane-3')

  const another = openSavedChat(opened.layout, group, { ...chat, id: 'another' }, ['Atlas', 'General'])
  const focused = openSavedChat(another.layout, group, { ...chat, agentId: 'other' }, ['Other', 'General'])
  assert.equal(findTab(content(focused.layout), tab => tab.id === second.tabId)?.pane.activeTabId, second.tabId)
})
