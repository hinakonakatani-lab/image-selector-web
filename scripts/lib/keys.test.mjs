import { test } from "node:test";
import assert from "node:assert/strict";
import {
  labelsKey,
  LABELS_SCAN_PATTERN,
  VOCAB_PLACES_KEY,
  VOCAB_SUBJECTS_KEY,
  isScanComplete,
} from "./keys.mjs";

test("labelsKey は shared 名前空間を使う", () => {
  assert.equal(labelsKey("ABC123"), "labels:shared:ABC123");
});
test("scan パターンと語彙キー", () => {
  assert.equal(LABELS_SCAN_PATTERN, "labels:shared:*");
  assert.equal(VOCAB_PLACES_KEY, "vocab:places");
  assert.equal(VOCAB_SUBJECTS_KEY, "vocab:subjects");
});

test("isScanComplete は数値 0 と文字列 \"0\" の両方を完了とみなす", () => {
  assert.equal(isScanComplete(0), true);
  assert.equal(isScanComplete("0"), true);
});
test("isScanComplete は非ゼロカーソルを未完了とみなす", () => {
  assert.equal(isScanComplete("15"), false);
  assert.equal(isScanComplete(15), false);
});
