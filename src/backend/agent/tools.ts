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

  type ExecResult = {
    exitCode: number | null;
    stdout: string | null;
    stderr: string | null;
    note: string | null;
  };
  const OUTPUT_CHAR_LIMIT = 10_000;
  let resString: string;

  // try catch to run command
  try {
    const { stdout, stderr } = await run("set -o pipefail; " + command, {
      cwd: cwd + "/toy", // directory the command runs in
      timeout: 30_000, // 30s; kill command if it takes longer than this
      maxBuffer: 1024 * 1024, // 1 mb; max stdout/stderr buffer size
      shell: "/bin/bash",
    });

    // get result
    const res: ExecResult = {
      exitCode: 0,
      stdout: stdout,
      stderr: stderr,
      note: null,
    };
    resString = JSON.stringify(res, null, 2);
  } catch (error: any) {
    // handle error
    const res: ExecResult = {
      exitCode: typeof error.code === "number" ? error.code : null,
      stdout: error.stdout,
      stderr: error.stderr,
      note: error.killed
        ? "killed after 30s timeout"
        : error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
          ? "output exceeded 1 MB and was cut off; use a narrower command"
          : null,
    };
    resString = JSON.stringify(res, null, 2);
  }

  return `Executed command: ${command}. Results: ${
    resString.length > OUTPUT_CHAR_LIMIT
      ? resString.slice(0, OUTPUT_CHAR_LIMIT / 2) +
        "\n[... truncated ...]\n" +
        resString.slice(-OUTPUT_CHAR_LIMIT / 2)
      : resString
  }`;
};
