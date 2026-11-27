// !!! to run: npx electron src/backend/agent/repl.ts "$dir"
// or npx electron src/backend/agent/repl.ts <repo-dir> for custom repo

import { existsSync } from "node:fs";

// Runs inside Electron (not plain Node) because Granite's ChatGPT tokens are
// encrypted with Electron's safeStorage, which only Electron can unlock.
import { app, safeStorage } from "electron";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { ChatGPTAccounts } from "../auth/chatgpt.ts";
// params
import { MODEL, INSTRUCTIONS } from "./params.ts";

import { openLog } from "./_log.ts";
import { runPrompt } from "./loop.ts";

// Same app name and data folder as `npm run dev`, so we find the same keychain key and accounts.
app.setName("granite");

async function main() {
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
  if (!account) {
    throw new Error(
      "Sign in to ChatGPT in Granite (npm run dev → Settings) first.",
    );
  }

  // cwd
  const cwd = process.argv[2];
  if (!cwd || !existsSync(cwd)) {
    throw new Error("Usage: npx electron src/backend/agent/repl.ts <repo-dir>");
  }

  // setting up logging
  const log = openLog("runs");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("close", () => app.exit(0)); // Ctrl-D ends the session

  // loop
  const max_turns = 10;
  const messages = [];
  const getToken = () => accounts.resolve(account.id);
  const approve = async (command: string) => {
    const approvalResponse = await rl.question(
      `Execute bash command? ${command} (y/n) `,
    );
    return approvalResponse.toLowerCase() === "y";
  };

  log("run_start", {
    cwd: cwd,
    model: MODEL,
    instructions: INSTRUCTIONS,
    maxTurns: max_turns,
  });

  while (true) {
    const prompt = await rl.question("> ");
    if (!prompt.trim()) continue; // handle empty input
    messages.push({ role: "user", content: prompt });

    log("user", { prompt: prompt });

    await runPrompt({ messages, max_turns, cwd, getToken, log, approve });
  }
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
