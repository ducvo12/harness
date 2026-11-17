import { useId, useRef, useState } from 'react'
import type { Agent, AgentMessage } from '../../../../shared/agent'
import type { Result, SavedConnection } from '../../../../shared/chat'
import { isLiveRun, type RunIntent } from '../../../../shared/run'
import type { WorkspaceChatState } from '../../app/useWorkspaceChats'
import ApprovalPrompt from '../harness/ApprovalPrompt'
import AttachedFiles from './AttachedFiles'
import ChatComposer from './ChatComposer'
import QuestionPrompt from './QuestionPrompt'
import RepositoryActivity from './RepositoryActivity'
import RunControls, { runLabel } from './RunControls'
import SavedTranscript, { type ReadingPosition } from './SavedTranscript'
import { messageWithAttachments, type ChatAttachment } from './attachments'
import { chatModelBinding, useConnectionModel } from './useConnectionModel'

export interface ComposerDraft {
  text: string
  attachments: ChatAttachment[]
}

interface WorkspaceChatProps {
  chat?: WorkspaceChatState
  agent?: Agent
  conversationId?: string
  path: string[]
  connections?: Result<SavedConnection[]>
  selectedConnection: string
  draft: ComposerDraft
  onDraftChange: (draft: Partial<ComposerDraft>) => void
  draftId: string
  onSelectConnection: (id: string) => void
  onOpenSettings: () => void
  onRetryConnections: () => void
  onSubmit: (connection: SavedConnection | undefined, model: string, effort: string, text: string, intent: RunIntent) => Promise<void>
  onError: (error: string) => void
  onReload: () => void
  readPosition: () => ReadingPosition | undefined
  savePosition: (position: ReadingPosition) => void
}

const noMessages: AgentMessage[] = []
const noConnections: SavedConnection[] = []

export default function WorkspaceChat({
  chat, agent, conversationId, path, connections, selectedConnection, draft, onDraftChange, draftId,
  onSelectConnection, onOpenSettings, onRetryConnections, onSubmit, onError, onReload, readPosition, savePosition
}: WorkspaceChatProps) {
  const result = chat?.result
  const messages = chat?.messages ?? (result?.ok ? result.value.messages : noMessages)
  const run = chat?.run
  const busy = Boolean(run && isLiveRun(run))
  const submitting = Boolean(chat?.submitting)
  const savedConnections = connections?.ok ? connections.value : noConnections
  const { connection, model, effort } = chatModelBinding(savedConnections, selectedConnection, messages, run)
  const modelSelection = useConnectionModel(connection, model, conversationId, effort)
  const loaded = !conversationId || result?.ok === true
  const transcript = result?.ok ? { ok: true as const, value: { ...result.value, messages } } : result
  const [activityOpen, setActivityOpen] = useState(false)
  const activityId = useId()
  const activityToggle = useRef<HTMLButtonElement>(null)

  async function send(intent: RunIntent) {
    if (!agent || !loaded || submitting) return
    const available = modelSelection.ready ? connection : undefined
    if (intent !== 'message' && !available) return
    if (intent === 'message' && !draft.text.trim() && !draft.attachments.length) return

    let text: string
    try {
      text = intent === 'message' ? messageWithAttachments(draft.text, draft.attachments) : ''
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not prepare attachments.')
      return
    }
    await onSubmit(available, modelSelection.model, modelSelection.effort, text, intent)
  }

  async function request(action: () => Promise<Result<void>>): Promise<boolean> {
    try {
      const outcome = await action()
      if (outcome.ok) return true
      onError(outcome.error)
    } catch {
      onError('Could not communicate with the desktop backend.')
    }
    return false
  }

  async function stop() {
    if (!run || !isLiveRun(run)) return
    try {
      await window.granite.stop(run.id)
    } catch {
      onError('Could not stop the reply.')
    }
  }

  const approval = chat?.approval
  const question = run?.question
  return (
    <div className="workspace-chat" data-chat-draft-id={draftId}>
      <div className="workspace-chat-layout">
        <SavedTranscript draft={!conversationId} result={transcript} path={path} retry={onReload} readPosition={readPosition} savePosition={savePosition} />

        {agent && conversationId && loaded && (
          <div className="workspace-chat-activity" onKeyDown={event => {
            if (event.key === 'Escape' && activityOpen && activityToggle.current?.getClientRects().length) {
              event.stopPropagation()
              setActivityOpen(false)
              activityToggle.current.focus()
            }
          }}>
            <button ref={activityToggle} type="button" className="workspace-activity-toggle quiet-button"
              aria-expanded={activityOpen} aria-controls={activityId} onClick={() => setActivityOpen(open => !open)}>
              Activity
            </button>

            <aside id={activityId} className="workspace-activity-panel" aria-label="Chat activity">
              <RepositoryActivity key={JSON.stringify([agent.id, conversationId])} agentId={agent.id}
                conversationId={conversationId} busy={busy} stopping={run?.phase === 'stopping'} run={run} onStop={stop} />
            </aside>
          </div>
        )}

        <div className="composer-area">
          {!busy && (
            <RunControls run={run} messages={messages} disabled={!modelSelection.ready || !loaded || submitting}
              onContinue={() => send('continue')} onRunPending={() => send('pending')} onCancelPending={async () => {
                if (agent && conversationId && await request(() => window.granite.runs.cancelPending(agent.id, conversationId))) onReload()
              }} />
          )}

          {run && question && (
            <QuestionPrompt key={question.id} question={question} autoFocus={false}
              onAnswer={answers => request(() => window.granite.harness.answer(run.id, question.id, answers))}
              onReject={() => request(() => window.granite.harness.rejectQuestion(run.id, question.id))} />
          )}

          {approval && (
            <ApprovalPrompt key={approval.id} request={approval} autoFocus={false} onAnswer={async allow => {
              await request(() => window.granite.harness.approve(approval.requestId, approval.id, allow))
            }} />
          )}

          {connections && !connections.ok && (
            <div className="error" role="alert">
              {connections.error}

              <button type="button" onClick={onRetryConnections}>
                Retry
              </button>
            </div>
          )}

          {loaded && model && !connection && (
            <div className="error" role="alert">
              Restore this chat’s saved connection to get a reply.

              {savedConnections.length > 0 && (
                <button type="button" onClick={onOpenSettings}>
                  Manage connections
                </button>
              )}
            </div>
          )}

          {modelSelection.error && <p className="error" role="alert">{modelSelection.error}</p>}

          {chat?.error && (
            <div className="error" role="alert">
              {chat.error}

              <button type="button" className="dismiss" aria-label="Dismiss error" onClick={() => onError('')}>
                ×
              </button>
            </div>
          )}

          <AttachedFiles attachments={draft.attachments} messages={messages} disabled={!loaded || submitting}
            onChange={attachments => onDraftChange({ attachments })} />

          <ChatComposer agent={agent} connections={savedConnections} connection={connection} modelSelection={modelSelection}
            messages={messages} draft={draft.text} attachments={draft.attachments} busy={busy} loaded={loaded} submitting={submitting}
            canSendWithoutModel stopping={run?.phase === 'stopping'} run={run} progress={run ? runLabel(run) : ''}
            onSelectConnection={onSelectConnection} onOpenSettings={onOpenSettings}
            onDraftChange={text => onDraftChange({ text })} onSend={() => send('message')} onStop={stop} />
        </div>
      </div>
    </div>
  )
}
