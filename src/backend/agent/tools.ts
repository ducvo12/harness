// bash stuff
import { exec } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(exec);
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cwd = __dirname;

export const handlers: Record<string, (args: any) => Promise<string>> = {
  get_miligrams: (args: get_miligrams_args) => get_miligrams(args),
  bash: (args: bash_args) => bash(args),
};

type get_miligrams_args = {
  section: number;
  beaker: number;
};
const get_miligrams = async (args: get_miligrams_args) => {
  return "32 mg";
};

type bash_args = {
  command: string;
};
const bash = async (args: bash_args) => {
  const { command } = args;

  try {
    const { stdout, stderr } = await run(command, {
      cwd: cwd + "/toy", // directory the command runs in
      timeout: 30_000, // ms; kills the command after this
      maxBuffer: 1024 * 1024, // max bytes of stdout/stderr (default 1 MB)
      shell: "/bin/bash", // default is /bin/sh; bash matches the tool's name
    });

    const LIMIT = 10_000;
    return `
    Executed command: ${command}.
    Results: ${
      stdout.length > LIMIT
        ? stdout.slice(0, LIMIT / 2) +
          "\n[... truncated ...]\n" +
          stdout.slice(-LIMIT / 2)
        : stdout
    }. 
    Errors: ${
      stderr.length > LIMIT
        ? stderr.slice(0, LIMIT / 2) +
          "\n[... truncated ...]\n" +
          stderr.slice(-LIMIT / 2)
        : stderr
    }`;
  } catch (error: any) {
    return `Error executing command: ${command}. Error: ${error}`;
  }
};
