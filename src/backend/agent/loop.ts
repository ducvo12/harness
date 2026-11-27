import { callModel } from "./model.ts";
import { MODEL, INSTRUCTIONS, TOOLS } from "./params.ts";
import { handlers } from "./tools.ts";
import { printItem, printResult } from "./_print.ts";

type runPromptArgs = {
  messages: any[];
  max_turns: number;
  cwd: string;
  getToken: () => Promise<string>;
  log: (type: string, fields: Record<string, unknown>) => void;
  approve: (command: string) => Promise<boolean>;
};
export async function runPrompt({
  messages,
  max_turns,
  cwd,
  getToken,
  log,
  approve,
}: runPromptArgs) {
  // turns
  let turns = 0;
  // resolve-request loop
  while (true) {
    // call model
    try {
      const events = await callModel(
        await getToken(),
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
              const approval = await approve(args.command);

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

      if (turns === max_turns) {
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
}
