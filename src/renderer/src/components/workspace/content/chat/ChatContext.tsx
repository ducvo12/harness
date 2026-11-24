import { createContext, useContext, type RefObject } from 'react'
import type { Agent, Conversation } from '../../../../../../shared/agent'
import type { Result, SavedConnection } from '../../../../../../shared/chat'
import type { useChatDrafts } from '../../../../app/useChatDrafts'
import type { useWorkspaceChats } from '../../../../app/useWorkspaceChats'
import type { ReadingPosition } from './transcript/Transcript'

interface ConnectionsState {
  connections?: Result<SavedConnection[]>
  selectedConnection: string
  selectConnection: (id: string) => void
  retry: () => void
  openSettings: () => void
}

interface ChatState {
  agents?: Result<Agent[]>
  chatDrafts: Pick<ReturnType<typeof useChatDrafts>, 'drafts' | 'get' | 'patch' | 'checkpoint' | 'clear'>
  chatSession: Pick<ReturnType<typeof useWorkspaceChats>, 'chats' | 'load' | 'submit' | 'setError'>
  showSavedChat: (saved: Conversation) => void
  positions: RefObject<Map<string, ReadingPosition>>
}

export const ConnectionsContext = createContext<ConnectionsState | undefined>(undefined)
export const ChatContext = createContext<ChatState | undefined>(undefined)

export function useConnectionsContext() {
  const context = useContext(ConnectionsContext)
  if (!context) throw new Error('Chat views require a connections context.')
  return context
}

export function useChatContext() {
  const context = useContext(ChatContext)
  if (!context) throw new Error('Chat views require a chat context.')
  return context
}
