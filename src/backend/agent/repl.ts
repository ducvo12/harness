// !!! to run: granite % npx electron src/backend/agent/repl.ts

// Runs inside Electron (not plain Node) because Granite's ChatGPT tokens are
// encrypted with Electron's safeStorage, which only Electron can unlock.
// Run: npx electron src/backend/agent/repl.ts
import { app, safeStorage } from "electron";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { ChatGPTAccounts } from "../auth/chatgpt.ts";
import { callModel } from "./model.ts";

// params
const MODEL = "gpt-5.6-luna";
const INSTRUCTIONS = "only speak in olden english";
const TOOLS = [
  {
    type: "function",
    name: "get_miligrams",
    strict: true,
    description: "Get the amount of miligrams of liquid in a beaker.",
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "integer",
          description: "The section number to get the beaker from.",
        },
        beaker: {
          type: "integer",
          description: "The beaker number to get the miligrams from.",
        },
      },
      required: ["section", "beaker"],
      additionalProperties: false,
    },
  },
];

const get_miligrams = (section: number, beaker: number) => {
  return "32 mg";
};

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
  for (;;) {
    const prompt = await rl.question("> ");
    if (!prompt.trim()) continue; // handle empty input
    messages.push({ role: "user", content: prompt });

    // resolve() refreshes the token when it is about to expire.

    // resolve-request loop
    let loop_finish = false;
    while (!loop_finish) {
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
              // loop_finish = true;
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
        loop_finish = true;
      } else {
        for (const call of function_calls) {
          if (call.name === "get_miligrams") {
            const args = JSON.parse(call.arguments);

            const section = args.section;
            const beaker = args.beaker;

            const result = get_miligrams(section, beaker);
            messages.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: result,
            });
          }
        }
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
