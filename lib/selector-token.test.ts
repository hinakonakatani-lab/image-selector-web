import { test } from "node:test";
import assert from "node:assert/strict";
import { selectorTokenOk } from "./selector-token.ts";

test("正しいBearerトークンは通る", () => {
  assert.equal(selectorTokenOk("Bearer abc", "abc"), true);
});

test("値が違うトークンは通らない", () => {
  assert.equal(selectorTokenOk("Bearer abd", "abc"), false);
});

test("長さが違うトークンは通らない", () => {
  assert.equal(selectorTokenOk("Bearer abcd", "abc"), false);
});

test("ヘッダーが無い・Bearerでない場合は通らない", () => {
  assert.equal(selectorTokenOk(null, "abc"), false);
  assert.equal(selectorTokenOk("abc", "abc"), false);
});

test("サーバー側のトークンが未設定・空なら、空のBearerでも通らない", () => {
  assert.equal(selectorTokenOk("Bearer ", undefined), false);
  assert.equal(selectorTokenOk("Bearer ", ""), false);
  assert.equal(selectorTokenOk("Bearer abc", undefined), false);
});
