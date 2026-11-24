import type { AgentMessage } from "../../../../../../shared/agent";
import { bridgeError, type Result, type SavedConnection } from "../../../../../../shared/chat";
import { isLiveRun, type RunIntent } from "../../../../../../shared/run";
import { emptyChatDraft } from "../../../../app/useChatDrafts";
import { chatKey } from "../../../../app/useWorkspaceChats";
import { chatId, type ChatDestination } from "../../layout/tabs";
import { useChatContext, useConnectionsContext } from "./ChatContext";
import ActivityPanel from "./activity/ActivityPanel";
import ApprovalPrompt from "./run/ApprovalPrompt";
import Composer from "./composer/Composer";
import QuestionPrompt from "./run/QuestionPrompt";
import RunControls from "./run/RunControls";
import Transcript from "./transcript/Transcript";
import {
  imagesFromAttachments,
  messageWithAttachments,
  type ChatAttachment,
} from "./attachments";
import {
  chatModelBinding,
  useConnectionModel,
} from "./composer/useConnectionModel";
import { useAttachmentPicker } from "./composer/useAttachmentPicker";

export interface ComposerDraft {
  text: string;
  attachments: ChatAttachment[];
}

interface ChatViewProps {
  conversation: ChatDestination;
  tabId: string;
}

const noMessages: AgentMessage[] = [];
const noConnections: SavedConnection[] = [];

export default function ChatView({ conversation, tabId }: ChatViewProps) {
  const { agents, chatDrafts, chatSession, showSavedChat, positions } =
    useChatContext();
  const {
    connections,
    selectedConnection,
    selectConnection,
    retry: retryConnections,
    openSettings,
  } = useConnectionsContext();
  const conversationId = conversation.id;
  const draftId = chatId(conversation);
  const identity = { agentId: conversation.agentId, id: draftId };
  const key = chatKey(identity);
  const draft = chatDrafts.drafts.get(draftId) ?? emptyChatDraft;
  const chat = chatSession.chats.get(key);
  const agent = agents?.ok
    ? agents.value.find((item) => item.id === conversation.agentId)
    : undefined;
  const onDraftChange = (change: Partial<ComposerDraft>) =>
    chatDrafts.patch(conversation, change);
  const onError = (error: string) => chatSession.setError(key, error);
  const onReload = () => {
    if (conversation.id !== undefined) chatSession.load(conversation, true);
  };
  const result = chat?.result;
  const messages =
    chat?.messages ?? (result?.ok ? result.value.messages : noMessages);
  const run = chat?.run;
  const busy = Boolean(run && isLiveRun(run));
  const submitting = Boolean(chat?.submitting);
  const savedConnections = connections?.ok ? connections.value : noConnections;
  const { connection, model, effort } = chatModelBinding(
    savedConnections,
    selectedConnection,
    messages,
    run,
  );
  const modelSelection = useConnectionModel(
    connection,
    model,
    conversationId,
    effort,
  );
  const loaded = !conversationId || result?.ok === true;
  const changeAttachments = (attachments: ChatAttachment[]) =>
    onDraftChange({ attachments });
  const attachmentPicker = useAttachmentPicker(
    draftId,
    draft.attachments,
    changeAttachments,
  );
  const transcript = result?.ok
    ? { ok: true as const, value: { ...result.value, messages } }
    : result;

  async function send(intent: RunIntent) {
    if (!agent || !loaded || submitting) return;
    const available = modelSelection.ready ? connection : undefined;
    if (intent !== "message" && !available) return;
    if (intent === "message" && !draft.text.trim() && !draft.attachments.length)
      return;

    let text: string;
    try {
      text =
        intent === "message"
          ? messageWithAttachments(draft.text, draft.attachments)
          : "";
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Could not prepare attachments.",
      );
      return;
    }
    const request = {
      connection: available,
      model: modelSelection.model,
      effort: modelSelection.effort,
      text,
      intent,
    };
    // TODO(human): submit the run with chatSession.submit(identity, request, message).
  }

  async function request(
    action: () => Promise<Result<void>>,
  ): Promise<boolean> {
    try {
      const outcome = await action();
      if (outcome.ok) return true;
      onError(outcome.error);
    } catch {
      onError(bridgeError);
    }
    return false;
  }

  async function stop() {
    if (!run || !isLiveRun(run)) return;
    try {
      await window.granite.stop(run.id);
    } catch {
      onError("Could not stop the reply.");
    }
  }

  const approval = chat?.approval;
  const question = run?.question;
  return (
    <div className="workspace-chat" data-chat-draft-id={draftId}>
      <div className="workspace-chat-layout">
        <Transcript
          draft={!conversationId}
          result={transcript}
          path={conversation.path}
          retry={onReload}
          readPosition={() => positions.current.get(tabId)}
          savePosition={(position) => positions.current.set(tabId, position)}
        />

        <ActivityPanel
          agentId={agent?.id}
          conversationId={conversationId}
          loaded={loaded}
          messages={messages}
          run={run}
          onStop={stop}
        />

        {/* The user input area as a whole */}
        <div className="composer-area">
          {!busy && (
            <RunControls
              run={run}
              messages={messages}
              disabled={!modelSelection.ready || !loaded || submitting}
              onContinue={() => send("continue")}
              onRunPending={() => send("pending")}
              onCancelPending={async () => {
                if (
                  agent &&
                  conversationId &&
                  (await request(() =>
                    window.granite.runs.cancelPending(agent.id, conversationId),
                  ))
                )
                  onReload();
              }}
            />
          )}

          {run && question && (
            <QuestionPrompt
              key={question.id}
              question={question}
              autoFocus={false}
              onAnswer={(answers) =>
                request(() =>
                  window.granite.harness.answer(run.id, question.id, answers),
                )
              }
              onReject={() =>
                request(() =>
                  window.granite.harness.rejectQuestion(run.id, question.id),
                )
              }
            />
          )}

          {approval && (
            <ApprovalPrompt
              key={approval.id}
              request={approval}
              autoFocus={false}
              onAnswer={async (allow) => {
                await request(() =>
                  window.granite.harness.approve(
                    approval.requestId,
                    approval.id,
                    allow,
                  ),
                );
              }}
            />
          )}

          {connections && !connections.ok && (
            <div className="error" role="alert">
              {connections.error}

              <button type="button" onClick={retryConnections}>
                Retry
              </button>
            </div>
          )}

          {loaded && model && !connection && (
            <div className="error" role="alert">
              Restore this chat’s saved connection to get a reply.
              {savedConnections.length > 0 && (
                <button type="button" onClick={openSettings}>
                  Manage connections
                </button>
              )}
            </div>
          )}

          {modelSelection.error && (
            <p className="error" role="alert">
              {modelSelection.error}
            </p>
          )}

          {chat?.error && (
            <div className="error" role="alert">
              {chat.error}

              <button
                type="button"
                className="dismiss"
                aria-label="Dismiss error"
                onClick={() => onError("")}
              >
                ×
              </button>
            </div>
          )}

          <Composer
            agent={agent}
            connections={savedConnections}
            connection={connection}
            modelSelection={modelSelection}
            messages={messages}
            draft={draft.text}
            attachments={draft.attachments}
            attachmentPicker={attachmentPicker}
            onAttachmentsChange={changeAttachments}
            loaded={loaded}
            submitting={submitting}
            run={run}
            onSelectConnection={selectConnection}
            onOpenSettings={openSettings}
            onDraftChange={(text) => onDraftChange({ text })}
            onSend={() => send("message")}
            onStop={stop}
          />
        </div>
      </div>
    </div>
  );
}
