import { test } from "node:test";
import assert from "node:assert/strict";
import { expandTerm, loadSynonymGroups } from "./synonyms.mjs";

const groups = [
  { canonical: "バルコニー", synonyms: ["ベランダ"] },
  { canonical: "洗面室", synonyms: ["洗面所"] },
];

test("expandTerm はグループ内の別表記から代表表記を含めて展開する", () => {
  const r = expandTerm("ベランダ", groups);
  assert.deepEqual(new Set(r), new Set(["ベランダ", "バルコニー"]));
});

test("expandTerm は代表表記からも同じグループを展開できる", () => {
  const r = expandTerm("バルコニー", groups);
  assert.deepEqual(new Set(r), new Set(["ベランダ", "バルコニー"]));
});

test("expandTerm はグループ外の語をそのまま1件だけ返す", () => {
  assert.deepEqual(expandTerm("リビング", groups), ["リビング"]);
});

test("expandTerm は空文字に空配列を返す", () => {
  assert.deepEqual(expandTerm("", groups), []);
});

test("expandTerm はgroups省略時グループ外扱いでそのまま返す", () => {
  assert.deepEqual(expandTerm("バルコニー"), ["バルコニー"]);
});

test("loadSynonymGroups は存在しないパスで空配列を返す（壊れない）", () => {
  assert.deepEqual(loadSynonymGroups("/nonexistent/path.json"), []);
});

test("loadSynonymGroups は実際の設定ファイルを読み込める", () => {
  const g = loadSynonymGroups();
  assert.ok(Array.isArray(g));
  assert.ok(g.length > 0);
  assert.ok(g.every((x) => typeof x.canonical === "string" && Array.isArray(x.synonyms)));
});
