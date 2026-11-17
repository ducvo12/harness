import { useState, type RefObject } from 'react'
import ActivityPanel from './ActivityPanel'
import type { ChatAttachment } from './attachments'
import type { Agent, AgentMessage } from '../../../../shared/agent'
import type { SavedConnection, StreamActivity } from '../../../../shared/chat'
import MessageList from './MessageList'
import ChatComposer from './ChatComposer'
import type { ModelSelection } from './useConnectionModel'
import type { Project, Section, ChatRetention } from '../../../../shared/organization'
import type { RunSnapshot } from '../../../../shared/run'
import RunControls, { runLabel } from './RunControls'
import QuestionPrompt from './QuestionPrompt'
import ProjectEntryPrompt from './ProjectEntryPrompt'
import ApprovalPrompt from '../harness/ApprovalPrompt'
import type { ApprovalRequest } from '../../../../shared/harness'
import { useAttachmentPicker } from './useAttachmentPicker'

type Props = {
  conversationId: string
  conversationTitle?: string
  retention?: ChatRetention
  expiresAt?: number | null
  onKeep?: () => Promise<void>
  section?: Section
  project?: Project
  messageInput: RefObject<HTMLTextAreaElement | null>
  agent: Agent | undefined
  connections: SavedConnection[]
  connection: SavedConnection | undefined
  modelSelection: ModelSelection
  busy: boolean
  run?: RunSnapshot
  submitting: boolean
  onEnterProject: (projectId: string) => Promise<boolean>
  onContinue: () => Promise<void>
  onRunPending: () => Promise<void>
  onCancelPending: () => Promise<void>
  approval: ApprovalRequest | null
  onAnswerQuestion: (answers: string[]) => Promise<boolean>
  onRejectQuestion: () => Promise<boolean>
  onApprove: (allow: boolean) => Promise<void>
  loaded: boolean
  identityDirty: boolean
  messages: AgentMessage[]
  activity: StreamActivity
  end: RefObject<HTMLDivElement | null>
  follow: RefObject<boolean>
  error: string
  draft: string
  attachments: ChatAttachment[]
  onAttachmentsChange: (files: ChatAttachment[]) => void
  elapsed: number
  stopping: boolean
  onSelectConnection: (id: string) => void
  onOpenSettings: () => void
  onCreateAgent: () => void
  onDismissError: () => void
  onDraftChange: (draft: string) => void
  onSend: () => Promise<void>
  onStop: () => Promise<void>
}

export default function ChatView({
  conversationId,
  conversationTitle,
  retention,
  expiresAt,
  onKeep,
  section,
  project,
  messageInput,
  agent,
  connections,
  connection,
  modelSelection,
  busy,
  run,
  submitting,
  onEnterProject,
  onContinue,
  onRunPending,
  onCancelPending,
  approval,
  onApprove,
  onAnswerQuestion,
  onRejectQuestion,
  loaded,
  identityDirty,
  messages,
  activity,
  end,
  follow,
  error,
  draft,
  attachments,
  onAttachmentsChange,
  elapsed,
  stopping,
  onSelectConnection,
  onOpenSettings,
  onCreateAgent,
  onDismissError,
  onDraftChange,
  onSend,
  onStop
}: Props) {
  const [panelOpen, setPanelOpen] = useState(true)
  const attachmentPicker = useAttachmentPicker(JSON.stringify([agent?.id, conversationId]), attachments, onAttachmentsChange)
  const reasoningProgress = activity.reasoningCharacters
    ? ` · ${activity.reasoningCharacters.toLocaleString()} reasoning characters`
    : ''
  const progress = `${run ? runLabel(run) : 'Preparing reply'} · ${elapsed}s${reasoningProgress}`

  return (
    <div className="chat-workspace">
      {section && (
        <header className="chat-heading">
          <nav className="chat-breadcrumb" aria-label="Chat location">
            <ol>
              <li title={section.name}>{section.name}</li>
              {project && <li title={project.name}>{project.name}</li>}
              <li aria-current="page" title={conversationTitle}>{conversationId ? conversationTitle ?? 'Chat' : 'New chat'}</li>
            </ol>
          </nav>
          <span className="chat-heading-status">{conversationId ? section.mode === 'closed' ? 'Closed' : 'Shared' : 'Unsaved draft'}</span>
          {retention === 'temporary' && (
            <div className="temporary-status-group">
              <span className="temporary-badge" title="Temporary chat will expire after 1 hour of inactivity">
                {expiresAt ? (expiresAt <= Date.now() ? 'Expiring…' : `Expires in ${Math.ceil((expiresAt - Date.now()) / 60000)}m`) : 'Expires in 1h'}
              </span>
              {onKeep && (
                <button type="button" className="quiet-button keep-chat-button" disabled={busy || submitting} onClick={() => void onKeep()}>
                  Keep
                </button>
              )}
            </div>
          )}
          <button className="quiet-button activity-toggle" aria-label={panelOpen ? 'Hide chat details' : 'Show chat details'} title={panelOpen ? 'Hide chat details' : 'Show chat details'}
            aria-expanded={panelOpen} aria-controls="chat-activity-panel" onClick={() => setPanelOpen(open => !open)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>
            {attachments.length > 0 && <span>{attachments.length}</span>}
          </button>
        </header>
      )}
      <div className="chat-workspace-body">
        <main className="chat-main">
          <MessageList
            key={conversationId || 'new-chat'}
            agent={agent}
            conversationId={conversationId}
            busy={busy}
            loaded={loaded}
            identityDirty={identityDirty}
            messages={messages}
            activity={activity}
            end={end}
            follow={follow}
            onCreateAgent={onCreateAgent}
          />

          <div className="composer-area">
            <ProjectEntryPrompt key={conversationId} run={run} currentProject={project?.id} onMove={onEnterProject} />
            <RunControls run={run} messages={messages} disabled={submitting || !loaded}
              onContinue={onContinue} onRunPending={onRunPending} onCancelPending={onCancelPending} />
            {run?.question && <QuestionPrompt key={run.question.id} question={run.question} onAnswer={onAnswerQuestion} onReject={onRejectQuestion} />}
            {approval && <ApprovalPrompt key={approval.id} request={approval} onAnswer={onApprove} />}
            {modelSelection.error && (
              <div className="error" role="alert">
                {modelSelection.error} Reload models in Connections to try again.
              </div>
            )}

            {error && (
              <div className="error" role="alert">
                {error}

                <button className="dismiss" aria-label="Dismiss error" onClick={onDismissError}>
                  ×
                </button>
              </div>
            )}

            <ChatComposer
              agent={agent}
              connections={connections}
              connection={connection}
              modelSelection={modelSelection}
              messages={messages}
              draft={draft}
              attachments={attachments}
              attachmentPicker={attachmentPicker}
              onAttachmentsChange={onAttachmentsChange}
              busy={busy}
              loaded={loaded}
              submitting={submitting}
              stopping={stopping}
              identityDirty={identityDirty}
              run={run}
              progress={progress}
              messageInput={messageInput}
              onSelectConnection={onSelectConnection}
              onOpenSettings={onOpenSettings}
              onDraftChange={onDraftChange}
              onSend={onSend}
              onStop={onStop}
            />
          </div>
        </main>
      {panelOpen && <ActivityPanel key={`${agent?.id}:${conversationId}:${project?.id ?? section?.id}`} agentId={agent?.id ?? ''} conversationId={conversationId}
        repository={Boolean(project?.repositoryPath)} busy={busy} stopping={stopping} run={run} messages={messages}
        onStop={onStop} />}
      </div>
    </div>
  )
}
