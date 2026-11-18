import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ConnectionDraft, SavedConnection } from '../../../../shared/chat'
import ApiConnectionEditor from './api/ApiConnectionEditor'
import ChatGPTConnectionEditor from './chatgpt/ChatGPTConnectionEditor'
import type { ProviderPreset } from './presets'

export type ConnectionSelection = { connection: SavedConnection } | { preset: ProviderPreset }

type Props = {
  connections: SavedConnection[]
  selection: ConnectionSelection
  onSave: (connection: SavedConnection) => void
  onClose: () => void
}

function initialDraft(selection: ConnectionSelection): ConnectionDraft {
  if ('connection' in selection) {
    const { connection } = selection
    return {
      id: connection.id,
      name: connection.name,
      baseUrl: connection.baseUrl,
      model: connection.model,
      apiKey: '',
      provider: connection.provider === 'codex' ? 'chatgpt' : connection.provider,
      protocol: connection.protocol,
      accountId: connection.accountId,
      effort: connection.effort,
      maxConcurrentRequests: connection.maxConcurrentRequests
    }
  }

  const { preset } = selection
  return {
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: '',
    model: preset.defaultModel || '',
    provider: preset.provider,
    protocol: preset.protocol,
    ...(preset.provider === 'chatgpt' ? { accountId: '', effort: '' } : {})
  }
}

const bridgeError = 'Could not communicate with the desktop backend.'

export default function ConnectionEditor({ connections, selection, onSave, onClose }: Props) {
  const [editing, setEditing] = useState(() => initialDraft(selection))
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const original = connections.find(item => item.id === editing.id)

  useEffect(() => {
    nameInput.current?.focus()
  }, [])

  function field(key: keyof ConnectionDraft, value: string | boolean | number | undefined) {
    setEditing(current => ({ ...current, [key]: value }))
    setError('')
    setNotice('')

    if (key === 'baseUrl' || key === 'apiKey' || key === 'accountId') {
      setModels([])
    }
  }

  async function loadModels() {
    setBusy(true)
    setError('')
    setNotice('')

    try {
      const result = await window.granite.models(editing)

      if (!result.ok) {
        setError(result.error)
        return
      }

      setModels(result.value)

      if (
        (!editing.model ||
          (editing.provider === 'chatgpt' && !result.value.includes(editing.model))) &&
        result.value[0]
      ) {
        field('model', result.value[0])
      }

      setNotice(
        result.value.length
          ? `Connected · ${result.value.length} model${result.value.length === 1 ? '' : 's'} available`
          : 'Connected · no models listed. Enter a model ID below.'
      )
    } catch {
      setError(bridgeError)
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      const result = await window.granite.connections.save(editing)

      if (!result.ok) {
        setError(result.error)
        return
      }

      onSave(result.value)
    } catch {
      setError(bridgeError)
    } finally {
      setBusy(false)
    }
  }

  const editor = {
    editing,
    original,
    models,
    busy,
    nameInput,
    field,
    onSave: save,
    onCancel: onClose,
    onLoadModels: loadModels
  }

  return (
    <>
      <button
        type="button"
        className="settings-back quiet-button"
        disabled={busy}
        onClick={onClose}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5m7 7-7-7 7-7" />
        </svg>

        <span>
          Back to providers
        </span>
      </button>

      {error && <div className="error" role="alert">{error}</div>}

      {notice && <div className="notice" role="status">{notice}</div>}

      {editing.provider === 'chatgpt' ? (
        <ChatGPTConnectionEditor connections={connections} {...editor} />
      ) : (
        <ApiConnectionEditor {...editor} />
      )}
    </>
  )
}
