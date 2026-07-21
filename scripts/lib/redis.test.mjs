import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLabels } from "./redis.mjs";

test("mergeLabels は fileId 単位で上書きマージ", () => {
  const existing = { i1: { scene: "屋内" }, i2: { scene: "屋外" } };
  const incoming = { i2: { scene: "屋内", place: "和室" }, i3: { scene: "屋外" } };
  const m = mergeLabels(existing, incoming);
  assert.equal(m.i1.scene, "屋内");
  assert.equal(m.i2.place, "和室");
  assert.equal(m.i3.scene, "屋外");
});
