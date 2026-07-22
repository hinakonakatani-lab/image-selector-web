import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "./redis.mjs";

test("readAllLabels / writeLabels がエクスポートされている", () => {
  assert.equal(typeof store.readAllLabels, "function");
  assert.equal(typeof store.writeLabels, "function");
});
