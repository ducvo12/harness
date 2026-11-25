# Later

Ideas parked until their time comes. Don't start these mid-week.

- **Winter break: mini-swe-agent as an eval baseline.** Run it on the same ~20 tasks and same GPT model as Granite and Codex. It's the "minimal, well-understood harness" reference point (bash-only, flat history). Needs its ChatGPT auth working first (`chatgpt/` model names failed with "model not supported" on Nov 23).
- **Winter break: sandbox bash for unattended eval runs.** The REPL asks y/n before each command, but the eval runner has no human to ask. Before running tasks unattended, run commands in a container (Docker) or under macOS Seatbelt (`sandbox-exec`, what Codex uses): writes limited to the task's temp copy, no network. Until then, only run the eval on planted-bug repos you wrote.
