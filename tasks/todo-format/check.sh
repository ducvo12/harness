#!/usr/bin/env bash
# Usage: check.sh <repo-dir>. Exit 0 = pass.
set -euo pipefail
cd "$1"

# The repo's own test must still pass (the agent should have updated it).
node --test >/dev/null

# Hidden check with different data, so hardcoding the sample output fails.
node --input-type=module -e '
import assert from "node:assert/strict";
import { render } from "./todo.js";
const todos = [
  { title: "A", done: false },
  { title: "B", done: true },
  { title: "C", done: true },
];
assert.equal(render(todos), "Todo (2/3 done)\n[ ] A\n[x] B\n[x] C");
'
echo PASS
