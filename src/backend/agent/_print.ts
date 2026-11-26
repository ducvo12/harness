// Terminal printing for the REPL. Display only: nothing here goes back to the model.
import { styleText } from "node:util";

const PREVIEW_LINES = 6;

// Prints one model output item. Reasoning is encrypted, so it is skipped.
export function printItem(item: any) {
  if (item.type === "message") {
    // streaming handles printing messages already
    console.log("\n");
  } else if (item.type === "function_call" && item.name !== "bash") {
    // bash calls are already shown by the approval prompt
    console.log(styleText("cyan", `→ ${item.name}(${item.arguments})`));
  }
}

// Prints a short, dimmed preview of a tool's output.
export function printResult(output: string) {
  let text = output;
  try {
    const result = JSON.parse(
      output.slice(output.indexOf("Results: ") + "Results: ".length),
    );
    // stderr first: it's short and usually explains a failure that a long stdout would push out of the preview
    text = [
      `exit ${result.exitCode}`,
      result.note,
      result.stderr,
      result.stdout,
    ]
      .map((part) => part?.replace(/^\n+|\s+$/g, "")) // drop blank edges, keep first-line indentation
      .filter(Boolean)
      .join("\n");
  } catch {
    // shortcut: truncated or non-bash output isn't valid JSON, so show it raw
  }

  const lines = text.trimEnd().split("\n");
  const hidden = lines.length - PREVIEW_LINES;
  const preview =
    lines.slice(0, PREVIEW_LINES).join("\n") +
    (hidden > 0 ? `\n… ${hidden} more lines` : "");
  console.log(styleText("dim", preview.replace(/^/gm, "  ")));
}
