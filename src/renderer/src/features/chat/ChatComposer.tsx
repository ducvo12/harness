import type { RefObject } from 'react'
import type { Agent, AgentMessage } from '../../../../shared/agent'
import type { SavedConnection } from '../../../../shared/chat'
import type { RunSnapshot } from '../../../../shared/run'
import type { ChatAttachment } from './attachments'
import ChatModelPicker from './ChatModelPicker'
import ContextIndicator from './ContextIndicator'
import { latestContextResponse } from './context-display'
import type { ModelSelection } from './useConnectionModel'

interface ChatComposerProps {
  agent: Agent | undefined
  connections: SavedConnection[]
  connection: SavedConnection | undefined
  modelSelection: ModelSelection
  messages: AgentMessage[]
  draft: string
  attachments: ChatAttachment[]
  busy: boolean
  loaded: boolean
  submitting: boolean
  stopping: boolean
  identityDirty?: boolean
  canSendWithoutModel?: boolean
  run?: RunSnapshot
  progress: string
  messageInput?: RefObject<HTMLTextAreaElement | null>
  onSelectConnection: (id: string) => void
  onOpenSettings: () => void
  onDraftChange: (draft: string) => void
  onSend: () => Promise<void>
  onStop: () => Promise<void>
}

export default function ChatComposer({
  agent, connections, connection, modelSelection, messages, draft, attachments,
  busy, loaded, submitting, stopping, identityDirty, canSendWithoutModel, run, progress, messageInput,
  onSelectConnection, onOpenSettings, onDraftChange, onSend, onStop
}: ChatComposerProps) {
  const contextResponse = latestContextResponse(messages, modelSelection.model)

  return (
    <form
      className={`composer ${busy ? 'generating' : ''}`}
      onSubmit={event => {
        event.preventDefault()
        void onSend()
      }}
    >
      <div className="composer-prompt-header" aria-hidden="true">
        <span className="composer-prompt-icon">✦</span>
        <span className="composer-prompt-host">archon:~$</span>
      </div>

      <textarea
        ref={messageInput}
        aria-label="Message"
        value={draft}
        disabled={submitting || (!connection && !canSendWithoutModel) || !agent || !loaded}
        placeholder={
          connection || canSendWithoutModel
            ? `Message ${agent?.name ?? 'your agent'}…`
            : 'Add a connection in Settings to begin'
        }
        rows={2}
        onChange={event => onDraftChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()

            if (!submitting) {
              void onSend()
            }
          }
        }}
      />

      <div className="composer-controls">
        <span className="composer-status">
          {busy ? progress : 'Enter to send · Shift + Enter for a new line'}
        </span>

        <div className="composer-actions">
          <ContextIndicator
            status={run?.context ?? contextResponse?.contextStatus}
            usage={contextResponse?.contextUsage}
            loading={!loaded || modelSelection.contextLoading}
            hasResponse={Boolean(contextResponse)}
            limit={modelSelection.contextWindow}
            maxOutput={modelSelection.maxOutputTokens}
            busy={busy}
          />
          {connections.length ? (
            <ChatModelPicker
              connections={connections}
              connection={connection}
              selection={modelSelection}
              disabled={busy || !loaded}
              onSelectConnection={onSelectConnection}
            />
          ) : (
            <button
              type="button"
              className="model-connect quiet-button"
              disabled={busy || !loaded || identityDirty}
              onClick={onOpenSettings}
            >
              Connect model
            </button>
          )}

          {busy ? (
            <button
              type="button"
              className="stop-button"
              disabled={stopping}
              onClick={() => void onStop()}
            >
              ■ {stopping ? 'Stopping…' : run?.startedAt === null ? 'Cancel queued' : 'Stop'}
            </button>
          ) : null}
          {(
            <button
              type="submit"
              className="send-button"
              aria-label={busy ? 'Send update' : 'Send message'}
              title={busy ? 'Send a message to steer this run' : 'Send message'}
              disabled={submitting || (!draft.trim() && !attachments.length) || (!modelSelection.ready && !canSendWithoutModel) || !agent || !loaded}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5m-6 6 6-6 6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
