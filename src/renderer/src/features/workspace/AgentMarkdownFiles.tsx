import { useCallback } from 'react'
import { isWorkspaceMarkdown } from '../../../../shared/workspace-markdown'
import { useSavedResource } from '../../app/useSavedResource'
import NotesTree from './NotesTree'

export default function AgentMarkdownFiles({ agentId, revision, onOpen }: {
  agentId: string
  revision: number
  onOpen: (path: string) => void
}) {
  const load = useCallback(() => window.granite.workspace.entries(agentId, '/'), [agentId])
  const { result, retry } = useSavedResource(load, 'Could not load workspace files.', revision)

  return (
    <div className="agent-markdown-files">
      {!result && <p className="tree-empty" role="status">Loading files…</p>}

      {result?.ok === false && (
        <div className="tree-empty" role="alert">
          {result.error}
          <button type="button" className="quiet-button" onClick={retry}>Retry</button>
        </div>
      )}

      {result?.ok && result.value.filter(entry => !entry.directory && isWorkspaceMarkdown(entry.path)).map(({ path }) => (
        <button key={path} type="button" className="tree-entry tree-file" title={path.slice(1)} onClick={() => onOpen(path)}>
          <span className="tree-file-icon" aria-hidden="true">▤</span>
          <span>{path.slice(1)}</span>
        </button>
      ))}

      <NotesTree agentId={agentId} disabled={false} revision={revision} selectedFile=""
        includeFile={isWorkspaceMarkdown} onOpen={onOpen} />
    </div>
  )
}
