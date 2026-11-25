// !!! to run: npx electron src/backend/agent/repl.ts

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

// Same app name and data folder as `npm run dev`, so we find the same keychain key and accounts.
app.setName("granite");

async function main() {
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
  while (true) {
    const prompt = await rl.question("> ");
    if (!prompt.trim()) continue; // handle empty input
    messages.push({ role: "user", content: prompt });

    // resolve() refreshes the token when it is about to expire.

    // turns
    let turns = 0;
    // resolve-request loop
    while (turns < MAX_TURNS) {
      // call model
      const events = await callModel(
        await accounts.resolve(account.id),
        MODEL,
        INSTRUCTIONS,
        TOOLS,
        messages,
      );

      // log messages
      const function_calls = [];
      for (const event of events) {
        if (event.event === "response.output_item.done") {
          const item = event.data.item;

          messages.push(item);
          console.log(item);

          if (item.type === "message") {
            if (item.phase === "final_answer") {
              // break
              // ^ commented because that end condition might be fragile
              // real end condition is below
            }
          }
          if (item.type === "function_call") {
            function_calls.push(item);
          }
        }
      }

      // resolve function calls if needed
      if (function_calls.length === 0) {
        break;
      } else {
        for (const call of function_calls) {
          const handler = Object.hasOwn(handlers, call.name)
            ? handlers[call.name as keyof typeof handlers]
            : undefined;

          if (handler) {
            const output = handler(JSON.parse(call.arguments));

            messages.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: output,
            });
          } else {
            messages.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: `Unknown function: ${call.name}. Available functions: ${TOOLS.map((t) => t.name).join(", ")}`,
            });
          }
        }
      }

      turns++;
      if (turns === MAX_TURNS) {
        console.log("hit turn limit");
      }
    }

    // end logs
    console.log("");

    console.log(messages);

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
