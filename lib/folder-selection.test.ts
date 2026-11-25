import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByNumber } from "./folder-selection.ts";

test("本目ごとにまとめ、fileId昇順で並べる。カスタム名が空なら null", () => {
  const result = groupByNumber({ b: 1, a: 1, c: 2 }, { a: "リビング", c: "" });
  assert.deepEqual(result, {
    "1": [
      { fileId: "a", renameName: "リビング" },
      { fileId: "b", renameName: null },
    ],
    "2": [{ fileId: "c", renameName: null }],
  });
});

test("入力が空なら空オブジェクト", () => {
  assert.deepEqual(groupByNumber({}, {}), {});
});

test("renameMap にだけ載っているIDは出力に含めない", () => {
  assert.deepEqual(groupByNumber({ a: 1 }, { zzz: "不要" }), {
    "1": [{ fileId: "a", renameName: null }],
  });
});

import { selectionPayload } from "./folder-selection.ts";

test("folderTagsのキーが存在しないときは found:false(IDの誤りと選定なしを区別する)", () => {
  assert.deepEqual(selectionPayload("F", null, null), { folderId: "F", found: false, selections: {} });
});

test("folderTagsが存在すれば found:true で本目ごとに返す", () => {
  assert.deepEqual(selectionPayload("F", { a: 1 }, null), {
    folderId: "F",
    found: true,
    selections: { "1": [{ fileId: "a", renameName: null }] },
  });
});
