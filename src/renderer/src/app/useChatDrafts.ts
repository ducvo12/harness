import { useRef, useState } from 'react'
import { z } from 'zod/mini'
import type { Agent, ConversationDetail } from '../../../shared/agent'
import type { ChatDestination } from '../components/panes/tabs'
import type { ComposerDraft } from '../features/chat/WorkspaceChat'

const storageKey = 'granite.workspace.chat-drafts'
const draftSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  text: z.string(),
  attachments: z.array(z.object({ id: z.string(), name: z.string(), size: z.int(), content: z.string(), dataUrl: z.optional(z.string()) })),
  location: z.optional(z.object({ sectionId: z.string(), projectId: z.nullable(z.string()) })),
  pendingId: z.optional(z.uuid())
})
const snapshot = z.object({ version: z.literal(1), drafts: z.array(draftSchema) })

type ChatDraft = z.output<typeof draftSchema>
type Drafts = ReadonlyMap<string, ChatDraft>

export const emptyChatDraft: ComposerDraft = { text: '', attachments: [] }

function loadDrafts(): Drafts {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const result = snapshot.safeParse(JSON.parse(raw))
      if (result.success) return new Map(result.data.drafts.map(draft => [draft.id, draft]))
    }
  } catch {
    // An unreadable draft snapshot does not prevent the workspace from opening.
  }
  return new Map()
}

export function useChatDrafts() {
  const [drafts, setDrafts] = useState(loadDrafts)
  const [error, setError] = useState('')
  const latest = useRef(drafts)
  const saved = useRef(drafts)

  function replace(next: Drafts) {
    latest.current = next
    setDrafts(next)
  }

  function checkpoint() {
    const next = latest.current
    if (saved.current === next) return false
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, drafts: [...next.values()] }))
      saved.current = next
      setError('')
      return true
    } catch {
      setError('Could not save chat drafts to this profile.')
      return false
    }
  }

  function patch(destination: ChatDestination, change: Partial<ComposerDraft> & { pendingId?: string }) {
    const id = destination.id ?? destination.draftId
    const prior = latest.current.get(id)
    const draft: ChatDraft = {
      ...(prior ?? emptyChatDraft), id, agentId: destination.agentId, location: destination.location,
      pendingId: undefined, ...change
    }
    const next = new Map(latest.current)
    if (draft.text.trim() || draft.attachments.length) next.set(id, draft)
    else next.delete(id)
    replace(next)
  }

  function clear(id: string) {
    if (!latest.current.has(id)) return
    const next = new Map(latest.current)
    next.delete(id)
    replace(next)
    checkpoint()
  }

  async function reconcile(agents: Agent[], current: () => boolean, promote: (chat: ConversationDetail) => void) {
    const groups = new Map<string, ChatDraft[]>()
    for (const draft of latest.current.values()) {
      const group = groups.get(draft.agentId)
      if (group) group.push(draft)
      else groups.set(draft.agentId, [draft])
    }
    await Promise.all([...groups].map(async ([agentId, drafts]) => {
      if (!agents.some(agent => agent.id === agentId)) return
      const result = await window.granite.conversations.list(agentId).catch(() => undefined)
      if (!result?.ok || !current()) return

      for (const draft of drafts) {
        const exists = result.value.some(chat => chat.id === draft.id)
        if (!exists && !draft.location && latest.current.get(draft.id) === draft) clear(draft.id)
        if (!exists || !draft.pendingId) continue
        const detail = await window.granite.conversations.get(agentId, draft.id).catch(() => undefined)
        if (!current() || latest.current.get(draft.id) !== draft) continue
        if (detail?.ok && detail.value.messages.some(message => message.id === draft.pendingId && message.role === 'user')) {
          if (draft.location) promote(detail.value)
          clear(draft.id)
        }
      }
    }))
  }

  return { drafts, error, patch, checkpoint, clear, reconcile, savedIds: () => new Set(saved.current.keys()), get: (id: string) => latest.current.get(id) }
}
