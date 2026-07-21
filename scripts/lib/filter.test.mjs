import { test } from "node:test";
import assert from "node:assert/strict";
import { filterByCriteria } from "./filter.mjs";

const items = [
  { folderId: "f1", fileId: "i1", label: { scene: "屋内", place: "リビング", subjects: ["ソファ"] } },
  { folderId: "f1", fileId: "i2", label: { scene: "屋外", place: "外観", subjects: ["庭"] } },
  { folderId: "f2", fileId: "i3", label: { scene: "屋内", place: "和室", subjects: ["畳","窓"] } },
];

test("scene と place(部分一致) で絞る", () => {
  const r = filterByCriteria(items, { scene: "屋内", place: "リビング" });
  assert.equal(r.length, 1);
  assert.equal(r[0].fileId, "i1");
});
test("subject 部分一致", () => {
  const r = filterByCriteria(items, { subject: "窓" });
  assert.deepEqual(r.map((x) => x.fileId), ["i3"]);
});
test("空 criteria は全通過", () => {
  assert.equal(filterByCriteria(items, {}).length, 3);
});
