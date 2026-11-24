import { createContext, useContext } from "react";
import ChatView from "../../content/chat/ChatView";
import MarkdownView, {
  type FileDraft,
} from "../../content/markdown/MarkdownView";
import ExplorerTab, { type ExplorerTabProps } from "../../explorer/ExplorerTab";
import type { Tab } from "../../layout/tabs";

interface TabBodyState {
  explorerProps: ExplorerTabProps;
  fileDrafts: ReadonlyMap<string, FileDraft>;
  updateFileDraft: (id: string, draft?: FileDraft) => void;
}

export const TabBodyContext = createContext<TabBodyState | undefined>(
  undefined,
);

export default function TabBody({ tab }: { tab: Tab }) {
  const context = useContext(TabBodyContext);
  if (!context) throw new Error("TabBody requires a workspace tab context.");

  const { explorerProps, fileDrafts, updateFileDraft } = context;
  const { agents } = explorerProps;

  // The active tab's type selects exactly one view for the pane body.
  if (tab.type === "agent") {
    return (
      <ExplorerTab agentId={tab.agentId} tabId={tab.id} {...explorerProps} />
    );
    //
  } else if (tab.type === "file") {
    const file = tab.file;
    if (!file || !agents?.ok) return null;

    const agent = agents.value.find((item) => item.id === file.agentId);
    if (!agent) return null;

    return (
      <MarkdownView
        agent={agent}
        path={file.path}
        draft={fileDrafts.get(tab.id)}
        setDraft={(draft) => updateFileDraft(tab.id, draft)}
      />
    );
    //
  } else if (tab.type === "chat") {
    const conversation = tab.conversation;
    if (!conversation) return null;

    return <ChatView conversation={conversation} tabId={tab.id} />;
  }
}
