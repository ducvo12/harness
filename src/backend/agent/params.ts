export const MODEL = "gpt-5.6-luna";
export const INSTRUCTIONS = "The user is on MacOS. Only speak in olden english";
export const TOOLS = [
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
  {
    type: "function",
    name: "bash",
    strict: true,
    description:
      "Run a shell command with /bin/bash and return its stdout. " +
      "Each call runs in a fresh shell starting at the repository root: `cd`, variables and " +
      "other state do NOT carry over between calls, so chain steps with && " +
      "(e.g. `cd src && ls`). Commands are killed after 30 seconds, so do not start servers, " +
      "watchers or anything that waits for input; use non-interactive flags (e.g. `git --no-pager`). " +
      "Long output is truncated, so prefer targeted commands (grep, head, sed -n) over printing " +
      "whole large files. The user may deny a command; if so, try a different approach.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to run, e.g. `ls -la` or `npm test`.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
];
