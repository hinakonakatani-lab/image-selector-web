import { test } from "node:test";
import assert from "node:assert/strict";
import { getBaseUrl } from "./api-config.mjs";

test("getBaseUrl は env から取得", () => {
  assert.equal(getBaseUrl({ LABELS_API_BASE: "https://x.example" }), "https://x.example");
});
test("未設定は例外", () => {
  assert.throws(() => getBaseUrl({}), /LABELS_API_BASE/);
});
test("http(s) でないURLは例外", () => {
  assert.throws(() => getBaseUrl({ LABELS_API_BASE: "ftp://x" }), /http/);
});
