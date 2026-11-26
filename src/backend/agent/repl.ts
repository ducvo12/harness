// !!! to run: npx electron src/backend/agent/repl.ts "$dir"
// or npx electron src/backend/agent/repl.ts <repo-dir> for custom repo

import { existsSync } from "node:fs";

// run logging
import { appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Runs inside Electron (not plain Node) because Granite's ChatGPT tokens are
// encrypted with Electron's safeStorage, which only Electron can unlock.
import { app, safeStorage } from "electron";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { ChatGPTAccounts } from "../auth/chatgpt.ts";
import { callModel } from "./model.ts";

// params
import { MODEL, INSTRUCTIONS, TOOLS } from "./params.ts";
// tools
import { handlers } from "./tools.ts";
import { printItem, printResult } from "./print.ts";

// Same app name and data folder as `npm run dev`, so we find the same keychain key and accounts.
app.setName("granite");

async function main() {
  // cwd
  const cwd = process.argv[2];
  if (!cwd || !existsSync(cwd)) {
    throw new Error("Usage: npx electron src/backend/agent/repl.ts <repo-dir>");
  }

  // setting up logging
  mkdirSync("runs", { recursive: true }); // no error if it already exists
  const logPath = `runs/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.jsonl`;
  type LogEntry = {
    type: string;
    time: string;
    [key: string]: unknown;
  };

  // accounts
  const accounts = new ChatGPTAccounts(
    join(app.getPath("appData"), "Granite Development"),
    {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptString(text),
      decrypt: (data) => safeStorage.decryptString(data),
    },
  );
  // shortcut: uses the most recently added account; add a choice if you keep several signed in.
  const account = (await accounts.list()).at(-1);
  if (!account)
    throw new Error(
      "Sign in to ChatGPT in Granite (npm run dev → Settings) first.",
    );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("close", () => app.exit(0)); // Ctrl-D ends the session

  // messages
  const messages = [];

  // loop
  const MAX_TURNS = 10;

  const startLog: LogEntry = {
    type: "run_start",
    time: new Date().toISOString(),
    cwd: cwd,
    model: MODEL,
    instructions: INSTRUCTIONS,
    maxTurns: MAX_TURNS,
  };
  appendFileSync(logPath, JSON.stringify(startLog) + "\n");

  while (true) {
    const prompt = await rl.question("> ");
    if (!prompt.trim()) continue; // handle empty input
    messages.push({ role: "user", content: prompt });

    const userPromptLog: LogEntry = {
      type: "user",
      time: new Date().toISOString(),
      prompt: prompt,
    };
    appendFileSync(logPath, JSON.stringify(userPromptLog) + "\n");

    // turns
    let turns = 0;
    // resolve-request loop
    while (true) {
      // call model
      try {
        const events = await callModel(
          await accounts.resolve(account.id),
          MODEL,
          INSTRUCTIONS,
          TOOLS,
          messages,
        );
        turns++;

        // log messages
        const function_calls = [];
        for (const event of events) {
          if (event.event === "response.output_item.done") {
            const item = event.data.item;

            messages.push(item);
            printItem(item);

            if (item.type === "message") {
              const text = item.content
                .filter((part: any) => part.type === "output_text")
                .map((part: any) => part.text)
                .join("");

              const modelOutputLog = {
                type: "model_output",
                time: new Date().toISOString(),
                model_output: text,
              };
              appendFileSync(logPath, JSON.stringify(modelOutputLog) + "\n");
            } else if (item.type === "function_call") {
              function_calls.push(item);

              const toolCallLog = {
                type: "tool_call",
                time: new Date().toISOString(),
                call_id: item.call_id,
                name: item.name,
                args: JSON.parse(item.arguments),
              };
              appendFileSync(logPath, JSON.stringify(toolCallLog) + "\n");
            }
          }
        }

        // resolve function calls if needed
        if (function_calls.length === 0) {
          const doneLog = {
            type: "done",
            time: new Date().toISOString(),
            reason: "no_tools_calls",
            turns: turns,
          };
          appendFileSync(logPath, JSON.stringify(doneLog) + "\n");

          break;
        } else {
          for (const call of function_calls) {
            const handler = Object.hasOwn(handlers, call.name)
              ? handlers[call.name as keyof typeof handlers]
              : undefined;

            if (handler) {
              const args = JSON.parse(call.arguments);

              if (call.name === "bash") {
                // checks for bash (needs approval)
                const approval = await rl.question(
                  `Execute bash command? ${args.command} (y/n) `,
                );

                if (approval.toLowerCase() === "y") {
                  const toolApprovalLog = {
                    type: "tool_approval",
                    time: new Date().toISOString(),
                    call_id: call.call_id,
                    name: call.name,
                    approval: true,
                  };
                  appendFileSync(
                    logPath,
                    JSON.stringify(toolApprovalLog) + "\n",
                  );
                } else {
                  messages.push({
                    type: "function_call_output",
                    call_id: call.call_id,
                    output: "Command execution cancelled.",
                  });

                  const toolApprovalLog = {
                    type: "tool_approval",
                    time: new Date().toISOString(),
                    call_id: call.call_id,
                    name: call.name,
                    approval: false,
                  };
                  appendFileSync(
                    logPath,
                    JSON.stringify(toolApprovalLog) + "\n",
                  );

                  continue; // skip to next function call if not approved
                }
              }

              const output = await handler(args, cwd);
              printResult(output);
              messages.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: output,
              });

              const toolOutputLog = {
                type: "tool_output",
                time: new Date().toISOString(),
                call_id: call.call_id,
                name: call.name,
                args: JSON.parse(call.arguments),
                output: output,
              };
              appendFileSync(logPath, JSON.stringify(toolOutputLog) + "\n");
            } else {
              // if function name not recognized
              messages.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: `Unknown tool: ${call.name}. Available tools: ${TOOLS.map((t) => t.name).join(", ")}`,
              });

              const unknownToolLog = {
                type: "unknown_tool",
                time: new Date().toISOString(),
                call_id: call.call_id,
                name: call.name,
              };
              appendFileSync(logPath, JSON.stringify(unknownToolLog) + "\n");
            }
          }
        }

        if (turns === MAX_TURNS) {
          console.log("hit turn limit");

          const doneLog = {
            type: "done",
            time: new Date().toISOString(),
            reason: "turn_limit",
            turns: turns,
          };
          appendFileSync(logPath, JSON.stringify(doneLog) + "\n");

          break;
        }
      } catch (error: any) {
        console.log("Error: " + error.message);

        const doneLog = {
          type: "done",
          time: new Date().toISOString(),
          reason: "error",
          error: error.message,
          turns: turns,
        };
        appendFileSync(logPath, JSON.stringify(doneLog) + "\n");

        break;
      }
    }

    // how many miligrams are in beaker 4 of section 2
  }
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
