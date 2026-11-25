# Paused, check agent branch

# Granite desktop development

> Current development guide, reviewed November 18, 2026. [Harness behavior](harness.md) describes delivered features; [the planning vault](<vault/Start Here.md>) separates remaining work and verification.

## Run and package

Use Node.js 22.12+ with the package's required tooling and npm. Install dependencies, then start development:

```sh
npm install
npm run dev
```

The development command prepares native PTY helpers, opens Electron and serves React with hot reload. Main/preload changes are rebuilt by electron-vite. Development data is separate from the packaged app (`Granite Development` on macOS).

| Command | Purpose |
| --- | --- |
| `npm run lint` | Targeted correctness, unused-binding, JSX key and hook checks across source, tests and scripts. |
| `npm run typecheck` | TypeScript validation. |
| `npm run typecheck:tests` | Strict TypeScript validation of tests/fixtures and their imported source. JavaScript helpers are included for import resolution; they are linted, not type-checked. |
| `npm test` | Prepare native helpers and run backend checks under Electron's Node ABI. |
| `npm run build` | Prepare PTY, type-check and compile main/worker/preload/renderer into `out/`. |
| `npm run preview` | Open the compiled app. |
| `npm run package` | Build and create a local unpacked app in `release/`. |
| `npm run dist` | Build an installer; public distribution needs platform signing configuration. |

SQLite and PTY native components must match Electron. Installation prepares them; packaged PTY helpers are unpacked through the build configuration. Packaging is not publishing.

The test runner discovers `.test.ts` and `.test.mjs` files recursively under `tests/`.
Use equals-form Node test options after npm's separator, for example:

```sh
npm test -- --test-name-pattern='model leases' --test-reporter=spec
```

Supported options are `--test-name-pattern`, `--test-skip-pattern`,
`--test-reporter`, `--test-concurrency` and `--test-timeout`. Unknown arguments
fail instead of being silently ignored.

## Saved-chat workspace

The workspace is the app's only shell. Open it with `npm run dev`, or run
`npm run preview` after building. The earlier shell was removed on November 17.

### Layout

- Explorer and Content are side-by-side regions that can swap places and keep
  their widths and split layouts. Their groups resize and split within their
  own region. Tabs merge or reorder at the tab strip and split on body drops.
  Dragging moves the existing view and preserves its identity.
- The layout is app-wide. It restores region order and widths, pane splits, and
  open saved views on launch. Layout logic lives in
  `components/workspace/layout/`.

### Chats

- Explorer opens chats in Content and focuses an existing view when one is open.
  The view owns scrolling and drafts. A conversation owns messages and runs,
  and closing its tab leaves the run active. Reopening a chat creates a fresh
  view at the latest message and shows the current reply. Separate chats can be
  viewed side by side, and the visible message and scroll offset survive tab
  switches, splits and merges. The duplicate-view gesture and draft recovery
  rules remain open. If duplicate views are introduced, Explorer should focus
  the most recently used one.
- Saved chats use the shared composer. They can send messages, display live
  replies, stop runs, and answer agent questions above the message box. The
  composer accepts images and text files, and chat activity (repository
  changes, commands, attached files) shows in the activity panel.
- **New chat** in Explorer opens a draft in the selected agent's General
  section. Section and project controls open drafts at their own locations.
  The first send saves the chat and its outgoing message together, before the
  provider is contacted. A connection or model failure leaves the message in
  the transcript. Closing an unsent tab leaves a draft in Explorer without
  creating a conversation.
- Chat drafts and text attachments save when switching or closing tabs and on
  normal quit, and restore when the chat reopens. Deleting a chat removes its
  draft. A crash can lose edits since the last save. Markdown drafts are
  session-only.

### Explorer

Explorer can create agents from the agent picker, Shared or Closed sections
for the selected agent, and chat-only projects within custom sections. A new
agent opens in the Explorer tab that created it. Markdown files open with
preview and editing (see Local data and interface). Settings opens from the
header as a modal.

Run `node scripts/verify-saved-chats-desktop.mjs` after a build. It launches
the workspace with fresh and seeded disposable profiles and a local simulated
provider. It covers opening, focusing, splitting, merging and reopening chats,
sending and stopping, draft and layout restoration, saving the outgoing message
when the provider is unavailable, and that browsing saved chats does not
prompt the model.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/main/` | Electron lifecycle/windows, validated IPC and private utility-worker client. |
| `src/preload/` | Narrow typed renderer bridge. |
| `src/backend/agents/` | Agent/chat organization, SQLite state, runs, worker and lifecycle. |
| `src/backend/harness/` | Granite-owned loop, scheduling, providers, tools/settings, approvals/questions. |
| `src/backend/repositories/` | Access, guarded edits, diffs, commands/PTY, setup authorization, previews and recovery. |
| `src/backend/auth/`, `connections/`, `models/` | Independent sign-in, encrypted connection/account storage and model access. |
| `src/backend/workspace/` | Protected agent files, initialization and file viewing. |
| `src/shared/` | Types across the desktop bridge. |
| `src/renderer/src/app/` | `App.tsx` composition plus session hooks (chat drafts, workspace chats, saved-chat and layout storage). |
| `src/renderer/src/components/` | UI by screen: `workspace/` (Explorer, content, layout, regions, panes), `settings/`, `header/`, `controls/`, `icons/`. |
| `src/renderer/src/styles/` | Stylesheets and design tokens (`tokens.css`). |
| `tests/` | Backend, harness, layout and renderer-logic tests, plus `tests/desktop/` for the desktop session helper. |
| `scripts/` | Test runner, PTY preparation, desktop verification (`verify-desktop.mjs`, `verify-saved-chats-desktop.mjs`) and live/framework checks. |

Keep Electron main and the worker built independently. The renderer has no Node integration, uses context isolation/sandboxing, and receives no saved model credentials. Validated HTTP/HTTPS links open in the system browser; arbitrary new windows/navigation and file/application links remain blocked.

### Renderer component reorganization

The renderer now groups UI code under `components/`. The former `features/`
files moved alongside the screens that use them. The layout follows the scope
of each component and keeps screen-specific behavior beside the controls that
trigger it, so the code is easier to find from the interface.

- `components/workspace/` contains the workspace shell, Explorer, content views,
  and pane layout. Explorer triggers agent, section, and project creation.
  `WorkspaceCreationDialog.tsx` sits beside `Workspace.tsx` because `App.tsx`
  opens it as a modal for the entire window.
- `components/settings/` contains the Connections screen opened from Settings.
  `Settings.tsx` switches between the list and editor and passes saved
  connection updates back to the app. `ConnectionList.tsx` handles disconnect
  confirmation, deletion, and model refresh for saved connections.
  `ConnectionEditor.tsx` owns the draft, loads models for it, and saves it.
  The provider-specific forms live in sibling `api/` and `chatgpt/` folders
  and use the same editing workflow.
- `components/controls/DropdownMenu.tsx` is shared by Settings and the chat
  composer. Its name describes the UI, and editable mode also accepts typed
  values. `components/icons/` holds the Chevron and TreeActionIcon SVG
  components. The unused `TreeMenu` popup and its dedicated CSS were removed.

## Readability conventions

Use two spaces, single quotes in TypeScript and one statement per line. Separate validation, state updates, requests and cleanup with blank lines. Group related state; separate effects and class methods.

In TSX, put a paired element's opening tag, content and closing tag on separate lines, including text-only elements. Leave a blank line between siblings. Empty elements stay self-closing; retain explicit spaces around inline elements.

```tsx
<section>
  <h2>
    Model connections
  </h2>

  <p>
    Bring a local server or an OpenAI-compatible API.
  </p>
</section>
```

Organize by feature/responsibility. Extract independent concerns when a file combines ideas; keep short cohesive functions intact. `App.tsx` composes pages; session hooks own state/actions; feature components render views. Preserve the lifecycle's integration while keeping transport, permissions and process/filesystem operations in their modules. Responsive styles load last.

Before completing a change, review its diff for a simpler expression of the same
behavior. Prefer clear branches to nested ternaries and boolean-mode helpers;
remove redundant state and parameters introduced by the change. Share genuinely
identical contracts, not merely similar-looking code. Preserve ownership,
cancellation, revisions and recovery. Readability matters more than line count.

`AGENTS.md` makes this review part of the coding-agent workflow. Oxlint uses an
explicit, small rule set in `.oxlintrc.json`; it does not enforce formatting or
function-length limits. Underscore-prefixed unused parameters and destructured
properties omitted from a rest object are intentional supported patterns.
TypeScript 7 is not supported by the current `typescript-eslint` peer range, so
the lint command uses Oxlint without forcing incompatible dependencies. Type-aware
promise analysis and exhaustive effect-dependency review are not part of this
initial lint baseline.

## Local data and interface

```text
application-data/
  connections.json
  chatgpt-accounts.json
  agent-deletions/<stable-agent-id>/  staged whole-agent deletion, not repository edits
  atlas.sqlite                     historical name retained for compatibility
  agents/<stable-agent-id>/
    agent.json
    identity.md
    memory.md
    harness.json
    skills/<name>/SKILL.md          current skill layout
    notes/
    tools/                         agent-local tools location
    sections/<stable-section-id>/
      projects/<stable-project-id>/
        repository/                optional internally created codebase
```

Chats/messages, membership and private native model state live in SQLite; external repository attachments point to folders elsewhere. Existing legacy Atlas data/checkpoints are retained or migrated. New profiles start without an agent. Stable IDs are independent of display names.

The sidebar is a file explorer for agents, identity/memory, notes, sections, projects and chats. Markdown has preview/Edit/Save/Cancel; revision checks protect external edits, unsaved drafts protect navigation, and core filenames stay fixed. The human editor currently blocks saves during agent work. Identity starts blank and opens in the ordinary file viewer; Edit and Save publish explicit user changes. Runtime instructions remain in code, with additional user instructions/tool settings in `harness.json`.

Agent/chat deletion already exists but requires work to finish and cannot erase unresolved recovery data. Source cleanup is implemented in Pass 4; full active/queued cascade deletion for projects/sections belongs to Pass 5. Internal code follows physical folder deletion; externally linked targets survive. Do not describe the planned lifecycle as implemented.

Whole-agent deletion first renames the intact agent folder into `agent-deletions/`.
Database deletion and its cleanup marker then commit in one transaction. A failed
transaction restores the intact folder; a committed deletion stays deleted even
if purging files fails. Granite reports pending cleanup and retries it at startup.
Recovery restores uncommitted staged folders before registry initialization. Live
folders conflicting with staged or committed deletion are preserved and the
affected agent is blocked; unrelated agents remain usable. The recovery notice
identifies the preserved storage. No automatic merge or overwrite is performed.

Human Markdown and identity saves share the context publisher's revision checks,
including a final check immediately before publication. Creation is exclusive;
unsafe links and invalid text are rejected. This narrows external-edit races but
is not an atomic compare-and-swap against arbitrary other filesystem writers.

## Connections and execution

Open Settings → Connections to add independent ChatGPT sign-in, a Responses API connection, or a Chat Completions local/compatible endpoint. See [the harness guide](harness.md) for details. A chat binds its model/provider after use; start a new chat for another model rather than assuming mid-session migration.

For LM Studio on another device, use that device's reachable server address (for example `http://192.168.1.50:1234/v1`); localhost refers to Granite's machine. The network/firewall must permit access. API keys use Electron safeStorage and are not sent back to the renderer; Linux plaintext fallback is rejected. Endpoint changes with saved keys require explicit key handling. Account sign-in belongs to Granite, not Codex.

There are **no whole-run time/step/tool-count caps** and no fixed terminal deadline. `src/backend/context/` owns scoped source indexing, provenance, file reconciliation, request token budgets and revision-aware cache reuse. The loop counts schemas and compacts older valid history before the configured model window fills. Full transcripts remain saved. See [the harness guide](harness.md) and [Pass 4 verification](<vault/archive/v0.1/Verification/Pass 4 Implementation & Testing.md>).

Repository commands, interactive sessions and previews currently require macOS confinement. Ordinary sessions/cache end with the run; only a verified ready managed preview may remain afterward without occupying model/project capacity. Previews use isolated snapshots, require refresh for newer code and stop on owning Stop/deletion/app closure. Commands support safe contained relative installer links, bounded download authorization and guarded publication. Full details: [harness guide](harness.md).

Messages accepted after final cleanup begins queue a successor run in the same
chat, waiting for the predecessor to settle. Stop during settlement cannot be
overwritten by successful completion. Live command output has a trailing
publication so a quiet prompt reaches both persisted reports and the activity UI.

The private worker/IPC request maps retain runtime sender and input validation.
Worker initialization has a two-minute deadline; graceful shutdown has a ten-second
overall grace period and then retires the worker. Ordinary requests, runs and
approval waits have no worker-client deadline. Retired workers cannot publish late
responses/deltas; failures never automatically replay an agent request.

Native tool arguments are parsed by their Zod schemas before approval, including
defaults, unknown-field rejection and refinements. MCP schemas are compiled once
with Ajv and defaults are normalized before invocation approval. Settings,
steering, ownership and revision checks still run after approval waits. Existing
MCP transport/invocation deadlines remain separate from the uncapped agent loop.

Workspace grep uses one deterministic implementation: case-sensitive literal
matching over permitted UTF-8 files up to 1 MiB, including hidden files and ignoring
repository ignore rules. File scopes are exact, directories recurse, and filename
globs without `/` match basenames; globs containing `/` match paths relative to the
requested scope. Git metadata, symlinks and protected organization roots are
excluded before reading or consuming the match budget. Repository search keeps its
separate ignore-aware, regex-capable, paginated contract.

## Verification

Use disposable profiles, repositories and local simulated providers for deterministic/destructive checks. Never seed synthetic chats or framework scaffolds into the user's normal data/codebase. A mock verifies Granite's plumbing, not real-model competence. Check broad follow-ups in [Tests to Run Later](<vault/Tests to Run Later.md>) and recorded results in [the vault index](<vault/Start Here.md>).

Run `npm run lint`, `npm run typecheck`, and `npm run typecheck:tests` before
completion. Run relevant tests during development, the full `npm test` for
cross-cutting changes, and always rebuild with `npm run build` after code changes.
Report actual results and unresolved failures; do not weaken assertions or add
broad suppressions to establish a passing baseline.

After building, verify the default workspace:

```sh
node scripts/verify-desktop.mjs
node scripts/verify-saved-chats-desktop.mjs
```

The smoke check also accepts `--packaged` to launch the unpacked macOS app
under `release/mac-arm64`.

The shared desktop session rejects occupied debugging ports and
bounds startup, CDP requests and shutdown. These verification deadlines do not
limit agent runs or repository commands. Desktop checks launch the existing
compiled output: run a fresh build first, and do not treat a source-revision note
from an old runner as proof of compiled-artifact provenance.

### Backend cleanup verification — cleanup Pass 3

> Historical results. The suite now has 268 tests, and the legacy desktop runners named here were removed on November 17.

The repository runner passed the live-PTY prompt assertion, along with publication, question, preview,
project-queue and worker-crash recovery scenarios. The offline agent runner also
checks restart restoration, committed deletion cleanup, preserved recovery
conflicts and unaffected-agent access through the actual worker/IPC bridge.

Lint, production/test type checks, all 231 automated tests and a fresh build
passed. Local-fixture desktop checks passed for deletion/recovery, agents, harness,
model picker, select positioning, multi-chat runs and repositories. These are
development-build/mock-provider results, not live-provider or packaged acceptance.
Existing module-type and ineffective-dynamic-import warnings remain visible.

These results describe the desktop runners from Pass 3. See the workspace commands above for the current desktop checks.

Real framework acceptance uses actual downloads in disposable repositories:

```sh
node scripts/verify-project-setup.mjs vite
node scripts/verify-project-setup.mjs next
```

An optional exact scaffold version may follow the framework. Registry failures must be reported, not hidden by an unrecorded fallback. Real-agent setup uses `scripts/verify-project-agent-live.mjs`, with the configured account or explicit local-model environment. It consumes provider usage/network when run; it is not a routine documentation check. Record provider/model/protocol and actual outcomes, including unavailable endpoints. See the dated 3A results for tested commands, versions, builds, previews and packaged walkthroughs.

Earlier baseline/live-agent results are retained in `docs/archive/`. They predate the current harness and cannot establish current architecture, limits or complete later-pass acceptance. Research notes under `docs/research/` remain investigations, not feature promises.

### Renderer cleanup verification — cleanup Pass 4

Pass 4 addressed UI state safety, message acceptance, streaming reconciliation, and provider configuration. Its file paths predate the November 18 reorganization above:
- **Message acceptance and draft preservation:** Submissions in `useAgentSession.ts` keep drafts and attached files intact and lock the composer until the backend confirms acceptance into SQLite via `delta.messages`. Failed submissions or network drops preserve the draft in place rather than clobbering newer user input.
- **Provider presets:** Replaced the bifurcated connection forms with a unified preset configuration (`presets.ts`). Dedicated presets for ChatGPT OAuth, OpenAI, Claude/Anthropic, Gemini, DeepSeek, Kimi/Moonshot, and generic OpenAI-compatible/local servers share one editor, automatically hiding Base URL and protocol controls for standard endpoints while keeping them editable for custom/local servers.
- **Settled stream buffer reconciliation:** `loadConversation` and `finishConversation` cleanly evict settled stream buffers, ensuring fresh database messages are authoritative and cannot be overwritten by stale in-flight deltas.
- **Message identity keying:** Replaced unstable compound timing keys in `MessageList.tsx` with stable `key={message.id}`, eliminating unnecessary DOM remounts and scroll/animation resets when response clocks bind.
- **Modal accessibility:** Added Escape dismissal and auto-focus for the recovery alertdialog in `App.tsx`.

Lint (`npm run lint`), TypeScript checks (`npm run typecheck`, `npm run typecheck:tests`), all targeted automated tests, and a fresh production build (`npm run build`) passed with 0 errors and 0 warnings.

### Final cleanup consolidation — cleanup Pass 5

Pass 5 concludes the 5-pass codebase cleanup, consolidating changes, eliminating obsolete styles, and verifying the whole system before starting v1 feature milestones. Its file paths predate the November 18 reorganization above:
- **Stylesheet and asset pruning:** Removed dead legacy selectors across `settings.css` (`.connection-card`, `.empty-connections`, `.auth-choice-*`), `responsive.css`, and `layout.css` (`.organization-content`, `.organization-create`, etc.). Upgraded the placeholder icon in `ConnectionList.tsx` to the DeepSeek whale SVG icon.
- **Simplicity and dead code audit:** Audited changes across Passes 1–4, ensuring zero unused imports, zero console debug logs, no dangling types, and clean single-responsibility boundaries.
- **Verified baseline:** Complete test suite, strict linter (`npm run lint`), source and test type checks (`npm run typecheck`, `npm run typecheck:tests`), and production build (`npm run build`) pass cleanly with 0 errors and 0 warnings.



## Future optimizations

### Section notes and reusable files

- Defer a section Notes UI. Keep existing notes on disk and preserve scoped
  retrieval while deciding whether agents should maintain reference material
  across chats.
- Use repository `AGENTS.md` for repo-specific instructions and agent
  `identity.md` for agent-wide instructions. Consider a single editable
  instructions file for a section or project without a repository if users
  need scope-specific guidance.
- Consider letting users copy an image or file from another chat or save it
  somewhere durable. Define file ownership and access across Shared and Closed
  sections before adding cross-chat transfers.

### Chat attachments

- If attachments become more frequent or larger, move image data from message
  JSON to a separate SQLite attachments table. Link each attachment to its
  message and store the raw bytes as a BLOB. Load transcript text and
  attachment names first, then fetch image bytes when needed.
- Add Word (`.docx`) attachments. Extract paragraphs and table text locally,
  preserve their reading order, and apply the existing text attachment limit.

### MD editor

- Add separate Edit and Preview tabs for the same Markdown file, with a
  **Preview to the Side** action like VS Code. Either tab can be docked in
  a Content pane. The preview updates as you type, and Save writes the
  edits to disk.

### Harness context and token efficiency
- **Stale tool output eviction:** Replace bulky historical tool results (such as large file reads or file-search listings from completed turns) with compact tombstone markers (`[Read N lines from <path> — evicted from history]`) to prevent the compound context tax on multi-step agent runs.
- **Dynamic command and test output truncation:** Condense verbose stdout/stderr logs from passing test suites and build commands in conversation history, preserving only status summaries, exit codes, and error backtraces.
- **Hierarchical/Sliding-window compaction:** Periodically summarize settled interaction blocks into structured checkpoints rather than repeatedly sending exhaustive raw transcripts on every tool hop.
- **Parallel tool-call emission:** Group independent read, glob, and status operations into single model round-trips where supported by the provider adapter.
- **Decoupled plan artifacts and context isolation:** Save planning outputs to a persistent external document (e.g., `plan.md` or task artifact) acting as a standalone source of truth. When transitioning from planning to execution, run execution in a clean, fresh context window that loads only the final plan and relevant source files, completely dropping the tokens spent on exploratory searches and conversational deliberation.
- **Planner subagent isolation:** Delegate codebase exploration, dependency tracing, and doc searches to ephemeral subagent sessions that report only concise findings back to the main harness, preventing intermediate tool outputs from polluting the primary context history.
- **Tool-level schema gating:** Strip write and terminal execution tools from the active schema during plan mode, enforcing read-only safety at the protocol boundary rather than relying on prompt compliance.


