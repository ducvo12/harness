# Agent Notes

What the agent got wrong (or surprisingly right), why, and what to change. Raw material for the write-up and the improvement rounds.

Entry format: **date · task** — what happened → cause → fix idea.

## Failures and recoveries

**Nov 24 · ad-hoc toy folder** — `find -printf` on macOS, answered wrong with confidence.
- The model ran GNU `find ... -printf` piped into another command. BSD `find` on macOS has no `-printf`, so it failed, but the pipe still exited 0. The success path of the bash handler also dropped stderr. The model saw empty output and confidently said the folder was empty.
- Cause: (1) a pipeline's exit status is the last command's, so the failure was hidden; (2) the harness threw away stderr on success.
- Fix (done, `d7ffcdf`): `set -o pipefail`, and one output format with `exitCode`, `stdout`, `stderr`, `note` on both paths.

**Nov 25 · todo-format** — same `find -printf` mistake, recovered this time.
- The model saw `exitCode: 1` and the stderr message, then switched to `ls -la` on its own.
- Takeaway: the same model mistake went from a wrong answer to a one-step detour purely because of a harness change. Good evidence that the harness matters, not just the model.

**Nov 25 + Nov 26 · paginate-bug** — Jest's `--runInBand` on a `node --test` project (2 of 2 runs).
- First command both times: `npm test -- --runInBand` → `node: bad option: --runInBand`, exit 9. It recovered on the next turn by reading `package.json` and running plain `npm test`.
- Cause: the model assumes Jest before looking at `package.json`. Still happened on Nov 26 after the macOS/BSD hint was added to the instructions, so it's not about the OS.
- Fix idea: costs one turn per run. Could add "check package.json before running tests" to the instructions and measure whether turns drop. Low priority while it recovers reliably.

**Nov 25 + Nov 26 · paginate-bug** — edits files with a `python3` heredoc (2 of 2 runs).
- With only a `bash` tool, it edits by running a Python snippet that does `read_text().replace(old, new)`, not `sed -i` (which differs between GNU and BSD).
- Fix idea: an `edit_file(path, old, new)` tool. Candidate improvement round: compare pass rate and turns with and without it.

**Nov 25 · both tasks** — leftover "speak in olden English" instruction leaked into behavior.
- A style instruction in `INSTRUCTIONS` showed up in the model's replies and leaked into the commands it ran.
- Cause: one instruction string mixed agent behavior with user style preferences.
- Fix (done): removed. Later design: separate agent instructions (owned by the harness, fixed for evals) from user preferences (scoped to "messages to the user only").

## Observations

**Nov 26 · paginate-bug** — parallel tool calls.
- In turn 2 the model asked for `cat` of all files *and* `npm test` in one response, before seeing either result. The JSONL log shows both `tool_call` events before any approval, which is why it logs in real order.

**Nov 25 · display** — JSON-escaped tool output is hard to read.
- The bash result is a JSON string inside the `Executed command: ... Results: {...}` text, so newlines show up as `\n` and quotes as `\"`. In the JSONL log it's escaped twice. The model copes; humans don't.
- Fix idea: return structured fields from handlers and format the model's text once; log the structured fields.

## Event format (JSONL, one file per REPL session in `runs/`)

Every line: `{ type, time, ...fields }`. Written by `log(type, fields)` from `openLog(dir)` in `src/backend/agent/_log.ts`.

| `type` | Fields | When |
|---|---|---|
| `run_start` | `cwd`, `model`, `instructions`, `maxTurns` | once, at startup |
| `user` | `prompt` | each prompt |
| `model_output` | `model_output` (text) | each assistant message |
| `tool_call` | `call_id`, `name`, `args` (parsed) | each tool call, as it arrives |
| `tool_approval` | `call_id`, `name`, `approval` (bool) | only for tools that need approval (bash) |
| `tool_output` | `call_id`, `name`, `args`, `output` (the string sent to the model) | after a tool runs |
| `unknown_tool` | `call_id`, `name` | the model called a tool that doesn't exist |
| `done` | `reason`, `turns`, (`error`) | end of each prompt |

- `done.reason`: `no_tool_calls` (the model finished), `turn_limit` (the harness stopped it), `error` (stream or HTTP error; `error` holds the message).
- `turns` = model calls completed for that prompt.
- Order is real order: all of one response's `tool_call`s come before their approvals and outputs. Pair them by `call_id`.
- Reasoning items are not logged (encrypted).
