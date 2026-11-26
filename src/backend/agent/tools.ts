// bash stuff
import { exec } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(exec);

export const handlers: Record<
  string,
  (args: any, cwd: string) => Promise<string>
> = {
  get_miligrams: (args: GetMilligramsArgs) => get_miligrams(args),
  bash: (args: BashArgs, cwd: string) => bash(args, cwd),
};

type GetMilligramsArgs = {
  section: number;
  beaker: number;
};
const get_miligrams = async (args: GetMilligramsArgs) => {
  return "32 mg";
};

type BashArgs = {
  command: string;
};
const bash = async (args: BashArgs, cwd: string) => {
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
      cwd: cwd, // directory the command runs in
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
