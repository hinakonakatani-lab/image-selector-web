import { test } from "node:test";
import assert from "node:assert/strict";
import { collectVocab, applyMerges } from "./vocab.mjs";

const items = [
  { label: { place: "玄関", subjects: ["ソファ"] } },
  { label: { place: "エントランス", subjects: ["ソファー"] } },
  { label: { place: "玄関", subjects: [] } },
];

test("collectVocab: place 頻度", () => {
  const v = collectVocab(items, "place");
  assert.equal(v.get("玄関"), 2);
  assert.equal(v.get("エントランス"), 1);
});
test("collectVocab: 配列フィールド", () => {
  const v = collectVocab(items, "subjects");
  assert.equal(v.get("ソファ"), 1);
  assert.equal(v.get("ソファー"), 1);
});
test("applyMerges: place を正規化", () => {
  const merged = applyMerges(items, "place", { "エントランス": "玄関" });
  assert.equal(merged[1].label.place, "玄関");
  assert.equal(collectVocab(merged, "place").get("玄関"), 3);
  // 非破壊
  assert.equal(items[1].label.place, "エントランス");
});
test("applyMerges: 配列フィールドも置換", () => {
  const merged = applyMerges(items, "subjects", { "ソファー": "ソファ" });
  assert.deepEqual(merged[1].label.subjects, ["ソファ"]);
});
