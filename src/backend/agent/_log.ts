import { appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Creates a new JSONL file in dir and returns a function that appends one event per line.
// type is a separate parameter so every log line is guaranteed to have one.
export function openLog(dir: string) {
  mkdirSync(dir, { recursive: true }); // no error if it already exists
  const path = `${dir}/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.jsonl`;

  return (type: string, fields: Record<string, unknown>) => {
    const log = { type: type, time: new Date().toISOString(), ...fields };
    appendFileSync(path, JSON.stringify(log) + "\n");
  };
}
