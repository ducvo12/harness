import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate } from "./paginate.js";

const letters = ["a", "b", "c", "d", "e"];

test("first page starts at the first item", () => {
  assert.deepEqual(paginate(letters, 1, 2).items, ["a", "b"]);
});

test("last page holds the leftover items", () => {
  assert.deepEqual(paginate(letters, 3, 2).items, ["e"]);
});

test("counts pages, rounding up", () => {
  assert.equal(paginate(letters, 1, 2).totalPages, 3);
});
