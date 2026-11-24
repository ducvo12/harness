// !!! to run: granite % npx electron src/backend/agent/repl.ts

// Runs inside Electron (not plain Node) because Granite's ChatGPT tokens are
// encrypted with Electron's safeStorage, which only Electron can unlock.
// Run: npx electron src/backend/agent/repl.ts
import { app, safeStorage } from "electron";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { ChatGPTAccounts } from "../auth/chatgpt.ts";
import { callModel } from "./model.ts";

// Must be a model your ChatGPT plan allows; Granite's model picker lists them.
const MODEL = "gpt-5.6-luna";

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
  for (;;) {
    const prompt = await rl.question("> ");
    if (!prompt.trim()) continue;
    // resolve() refreshes the token when it is about to expire.
    const input = [{ role: "user", content: prompt }];
    const events = await callModel(
      await accounts.resolve(account.id),
      MODEL,
      input,
    );

    // print
    for (const event of events) {
      if (event.event === "response.output_text.delta") {
        process.stdout.write(event.data.delta);
      }
    }

    console.log("");
  }
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
