import { useState } from 'react'
import type { SavedConnection } from '../../../shared/chat'
import { useSavedResource } from './useSavedResource'

const storageKey = 'granite.connection'

function loadConnections() {
  return window.granite.connections.list()
}

export function useConnections() {
  const [selected, setSelected] = useState(() => localStorage.getItem(storageKey) ?? '')
  // Settings edits replace the loaded list until the next reload.
  const [edited, setEdited] = useState<SavedConnection[]>()
  const { result: saved, retry } = useSavedResource(loadConnections, 'Could not load your connections.')
  const connections = edited ? { ok: true as const, value: edited } : saved
  // A removed or missing choice falls back to the first saved connection.
  const selectedConnection = connections?.ok
    ? (connections.value.find(item => item.id === selected) ?? connections.value[0])?.id ?? ''
    : ''

  function selectConnection(id: string) {
    setSelected(id)
    localStorage.setItem(storageKey, id)
  }

  return { connections, selectedConnection, selectConnection, retry, setEdited }
}
