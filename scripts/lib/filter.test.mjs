import { test } from "node:test";
import assert from "node:assert/strict";
import { filterByCriteria } from "./filter.mjs";

const items = [
  { folderId: "f1", fileId: "i1", label: { scene: "屋内", place: "リビング", subjects: ["ソファ"], freeTags: ["明るい"] } },
  { folderId: "f1", fileId: "i2", label: { scene: "屋外", place: "外観", subjects: ["庭"], freeTags: [] } },
  { folderId: "f2", fileId: "i3", label: { scene: "屋内", place: "和室", subjects: ["畳", "窓"], freeTags: ["ナチュラル"] } },
  { folderId: "f2", fileId: "i4", label: { scene: "屋内", place: "リビング", subjects: ["バルコニー"], freeTags: [] } },
];

test("scene と place(配列・部分一致) で絞る", () => {
  const r = filterByCriteria(items, { scene: "屋内", place: ["リビング"] });
  assert.deepEqual(r.map((x) => x.fileId), ["i1", "i4"]);
});

test("subjects は軸内OR（配列のいずれかに部分一致すればヒット）", () => {
  const r = filterByCriteria(items, { subjects: ["窓", "ソファ"] });
  assert.deepEqual(r.map((x) => x.fileId), ["i1", "i3"]);
});

test("freeTags 条件に対応する", () => {
  const r = filterByCriteria(items, { freeTags: ["ナチュラル"] });
  assert.deepEqual(r.map((x) => x.fileId), ["i3"]);
});

test("空 criteria は全通過", () => {
  assert.equal(filterByCriteria(items, {}).length, 4);
});

test("同義語グループを渡すと展開して照合する（軸間ANDも維持される）", () => {
  const groups = [{ canonical: "バルコニー", synonyms: ["ベランダ"] }];
  const r = filterByCriteria(items, { subjects: ["ベランダ"] }, groups);
  assert.deepEqual(r.map((x) => x.fileId), ["i4"]);
});

test("同義語グループ未指定なら別表記は素通りしない", () => {
  const r = filterByCriteria(items, { subjects: ["ベランダ"] });
  assert.deepEqual(r.map((x) => x.fileId), []);
});
