import { useEffect, useState } from 'react'
import type { Agent } from '../../../../shared/agent'
import { isWorkspaceMarkdown } from '../../../../shared/workspace-markdown'
import FormattedResponse from '../chat/FormattedResponse'

export interface FileDraft {
  original: string
  text: string
  saving?: boolean
  error?: string
}

interface FileViewProps {
  agent: Agent
  path: string
  busy?: boolean
  onDirty?: (value: boolean) => void
  onSaved?: () => void
  edit?: { draft: FileDraft | undefined; setDraft: (draft: FileDraft | undefined) => void }
}

export default function FileView({ agent, path, busy, onDirty, onSaved, edit }: FileViewProps) {
  const [original, setOriginal] = useState('')
  const [localDraft, setLocalDraft] = useState<FileDraft>()
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState('')
  const [revision, setRevision] = useState(0)
  const draft = edit ? edit.draft : localDraft
  const setDraft = edit ? edit.setDraft : setLocalDraft
  const editing = Boolean(draft)
  const dirty = Boolean(draft && draft.text !== draft.original)
  const saving = Boolean(draft?.saving)
  const error = draft ? draft.error : readError

  useEffect(() => {
    onDirty?.(dirty || saving)
    return () => onDirty?.(false)
  }, [dirty, saving, onDirty])

  useEffect(() => {
    if (editing) return
    let current = true
    setLoading(true)
    void window.granite.workspace.read(agent.id, path).then(result => {
      if (!current) return
      if (result.ok) {
        setOriginal(result.value)
        setReadError('')
      } else {
        setReadError(result.error)
      }
    }).catch(() => {
      if (current) setReadError('Could not load this file.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [agent.id, path, revision, editing])

  async function save() {
    if (!draft || busy || saving || !dirty) return
    setDraft({ ...draft, saving: true, error: undefined })
    try {
      const result = await window.granite.workspace.save(agent.id, path, draft.text, draft.original)
      if (!result.ok) {
        setDraft({ ...draft, saving: false, error: result.error })
        return
      }
      setOriginal(result.value)
      setDraft(undefined)
      onSaved?.()
    } catch {
      setDraft({ ...draft, saving: false, error: 'Could not save this file. Your draft is still here.' })
    }
  }

  return (
    <main className="file-main">
      <header className="file-heading">
        <div className="file-breadcrumb" title={`${agent.name}${path}`}>
          {agent.name} / {path.slice(1)}{dirty && <span className="file-dirty"> · Unsaved</span>}
        </div>

        <div className="file-actions">
          {draft ? (
            <>
              <button className="quiet-button" disabled={saving} onClick={() => setDraft(undefined)}>Cancel</button>

              <button disabled={busy || saving || !dirty} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          ) : (
            <>
              <button className="quiet-button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</button>

              {isWorkspaceMarkdown(path) && (
                <button className="quiet-button" disabled={busy || loading || Boolean(error)}
                  onClick={() => setDraft({ original, text: original })}>Edit</button>
              )}
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="file-error error" role="alert">
          {error}
          {draft && <button className="quiet-button" disabled={saving} onClick={() => setDraft(undefined)}>Discard draft and reload</button>}
        </div>
      )}

      {draft ? (
        <div className="file-editor-wrap">
          <textarea className="file-editor" aria-label={`Edit ${path.split('/').at(-1)}`} autoFocus spellCheck={false}
            value={draft.text} maxLength={path === '/identity.md' ? 32_000 : 100_000} disabled={saving}
            onChange={event => setDraft({ ...draft, text: event.target.value })} onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                event.preventDefault()
                void save()
              }
              if (event.key === 'Tab') {
                event.preventDefault()
                const element = event.currentTarget
                const start = element.selectionStart
                const end = element.selectionEnd
                setDraft({ ...draft, text: draft.text.slice(0, start) + '  ' + draft.text.slice(end) })
                requestAnimationFrame(() => element.setSelectionRange(start + 2, start + 2))
              }
            }} />

          <div className="file-editor-status">Markdown · {draft.text.split('\n').length} lines · {draft.text.length.toLocaleString()} characters</div>
        </div>
      ) : (
        <section className="file-preview" aria-label="File preview" aria-busy={loading}>
          {loading ? <p>Loading…</p> : !error && (path.endsWith('.md') ? <FormattedResponse text={original || '*This file is empty.*'} /> : <pre>{original}</pre>)}
        </section>
      )}
    </main>
  )
}
