import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { Result } from '../../../../shared/chat'
import type { SectionMode } from '../../../../shared/organization'

interface Props {
  kind: 'agent' | 'section' | 'project'
  sectionName?: string
  onCreate: (name: string, mode: SectionMode) => Promise<Result<unknown>>
  onClose: () => void
}

export default function WorkspaceCreationDialog({ kind, sectionName, onCreate, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const pending = useRef(false)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<SectionMode>('shared')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const nameLabel = `${kind[0].toUpperCase()}${kind.slice(1)} name`

  useLayoutEffect(() => {
    const element = dialog.current!
    if (!element.open) element.showModal()
  }, [])

  async function submit() {
    if (pending.current || !name.trim()) return

    pending.current = true
    setSaving(true)
    setError('')
    try {
      const result = await onCreate(name, mode)
      if (result.ok) dialog.current?.close()
      else setError(result.error)
    } catch {
      setError(`Could not create the ${kind}. Try again.`)
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return (
    <dialog className="tree-dialog workspace-creation" ref={dialog} aria-labelledby={heading} onClose={onClose}
      onCancel={event => {
        if (pending.current) event.preventDefault()
      }}>
      <h2 id={heading}>
        New {kind}{sectionName && ` in ${sectionName}`}
      </h2>

      {error && <div className="error" role="alert">{error}</div>}

      <form onSubmit={event => {
        event.preventDefault()
        void submit()
      }}>
        <label>
          {nameLabel}
          <input required maxLength={80} value={name} disabled={saving} onChange={event => setName(event.target.value)} />
        </label>

        {kind === 'section' && (
          <label>
            Section memory
            <select value={mode} disabled={saving} onChange={event => setMode(event.target.value as SectionMode)}>
              <option value="shared">Shared</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        )}

        <div className="tree-dialog-actions">
          <button type="button" className="quiet-button" disabled={saving} onClick={() => dialog.current?.close()}>
            Cancel
          </button>

          <button type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : `Create ${kind}`}
          </button>
        </div>
      </form>
    </dialog>
  )
}
