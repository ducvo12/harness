// !!! to run: npx electron src/backend/agent/repl.ts "$dir"
// or npx electron src/backend/agent/repl.ts <repo-dir> for custom repo

import { existsSync } from "node:fs";

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
import { printItem, printResult } from "./_print.ts";
import { openLog } from "./_log.ts";

// Same app name and data folder as `npm run dev`, so we find the same keychain key and accounts.
app.setName("granite");

async function main() {
  // cwd
  const cwd = process.argv[2];
  if (!cwd || !existsSync(cwd)) {
    throw new Error("Usage: npx electron src/backend/agent/repl.ts <repo-dir>");
  }

  // setting up logging
  const log = openLog("runs");

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

  log("run_start", {
    cwd: cwd,
    model: MODEL,
    instructions: INSTRUCTIONS,
    maxTurns: MAX_TURNS,
  });

  while (true) {
    const prompt = await rl.question("> ");
    if (!prompt.trim()) continue; // handle empty input
    messages.push({ role: "user", content: prompt });

    log("user", { prompt: prompt });

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

              log("model_output", { model_output: text });
            } else if (item.type === "function_call") {
              function_calls.push(item);

              log("tool_call", {
                call_id: item.call_id,
                name: item.name,
                args: JSON.parse(item.arguments),
              });
            }
          }
        }

        // resolve function calls if needed
        if (function_calls.length === 0) {
          log("done", { reason: "no_tool_calls", turns: turns });

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
                const approvalResponse = await rl.question(
                  `Execute bash command? ${args.command} (y/n) `,
                );

                const approval = approvalResponse.toLowerCase() === "y";

                log("tool_approval", {
                  call_id: call.call_id,
                  name: call.name,
                  approval: approval,
                });

                if (!approval) {
                  messages.push({
                    type: "function_call_output",
                    call_id: call.call_id,
                    output: "Command execution cancelled.",
                  });
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

              log("tool_output", {
                call_id: call.call_id,
                name: call.name,
                args: JSON.parse(call.arguments),
                output: output,
              });
            } else {
              // if function name not recognized
              messages.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: `Unknown tool: ${call.name}. Available tools: ${TOOLS.map((t) => t.name).join(", ")}`,
              });

              log("unknown_tool", {
                call_id: call.call_id,
                name: call.name,
              });
            }
          }
        }

        if (turns === MAX_TURNS) {
          console.log("hit turn limit");

          log("done", { reason: "turn_limit", turns: turns });

          break;
        }
      } catch (error: any) {
        console.log("Error: " + error.message);

        log("done", {
          reason: "error",
          error: error.message,
          turns: turns,
        });

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
