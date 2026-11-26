import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./todo.js";

test("renders each todo on its own line", () => {
  const todos = [
    { title: "Buy milk", done: true },
    { title: "Fix bike", done: false },
  ];
  assert.equal(render(todos), "Buy milk - done\nFix bike - not done");
});
