import { test } from "node:test";
import assert from "node:assert/strict";
import { isAppleDoubleName, normalizeName, resolveDuplicates, chunk, planBatches } from "./batch-plan.mjs";

test("isAppleDoubleName は ._ 接頭辞だけを弾く", () => {
  assert.equal(isAppleDoubleName("._DSC001.jpg"), true);
  assert.equal(isAppleDoubleName("DSC001.jpg"), false);
  assert.equal(isAppleDoubleName("_DSC001.jpg"), false);
});

test("normalizeName は大小のみ無視し拡張子は残す", () => {
  assert.equal(normalizeName("S7_05923.JPG"), "s7_05923.jpg");
  assert.notEqual(normalizeName("x.JPG"), normalizeName("x-HDR.JPG"));
});

test("chunk は指定サイズで分割し端数を残す", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.throws(() => chunk([1], 0));
});

test("resolveDuplicates は同プロパティ内の同名を画像数最大のリーフに寄せる", () => {
  const byLeaf = {
    big: [{ id: "b1", title: "a.jpg" }, { id: "b2", title: "b.jpg" }],
    small: [{ id: "s1", title: "a.jpg" }],
  };
  const propertyOfLeaf = { big: "P", small: "P" };
  const { canonicalOf, mirrorsOf } = resolveDuplicates({ byLeaf, propertyOfLeaf });
  assert.equal(canonicalOf.b1, true);
  assert.equal(canonicalOf.s1, undefined);
  assert.deepEqual(mirrorsOf.b1, [{ leafId: "small", fileId: "s1" }]);
});

test("resolveDuplicates は別プロパティの同名を重複扱いしない（他人の空似を守る）", () => {
  const byLeaf = {
    l1: [{ id: "x", title: "DSC001.jpg" }],
    l2: [{ id: "y", title: "DSC001.jpg" }],
  };
  const propertyOfLeaf = { l1: "PropA", l2: "PropB" };
  const { canonicalOf, mirrorsOf } = resolveDuplicates({ byLeaf, propertyOfLeaf });
  assert.equal(canonicalOf.x, true);
  assert.equal(canonicalOf.y, true);
  assert.deepEqual(mirrorsOf, {});
});

test("planBatches は AppleDouble・NG・既タグを除外して集計する", () => {
  const byLeaf = {
    L: [
      { id: "keep", title: "1.jpg" },
      { id: "junk", title: "._1.jpg" },
      { id: "ng", title: "2.jpg" },
      { id: "done", title: "3.jpg" },
    ],
  };
  const r = planBatches({
    byLeaf,
    propertyOfLeaf: { L: "P" },
    ngFileIds: new Set(["ng"]),
    taggedFileIds: new Set(["done"]),
    batchSize: 24,
  });
  assert.equal(r.stats.totalImages, 4);
  assert.equal(r.stats.appleDouble, 1);
  assert.equal(r.stats.ng, 1);
  assert.equal(r.stats.alreadyTagged, 1);
  assert.equal(r.stats.needVision, 1);
  assert.deepEqual(r.batches, [{ leafId: "L", files: [{ id: "keep", title: "1.jpg" }] }]);
});

test("planBatches は重複コピーを vision せず propagate に回す", () => {
  const byLeaf = {
    main: [{ id: "m1", title: "a.jpg" }, { id: "m2", title: "b.jpg" }],
    copy: [{ id: "c1", title: "a.jpg" }],
  };
  const r = planBatches({ byLeaf, propertyOfLeaf: { main: "P", copy: "P" }, batchSize: 24 });
  assert.equal(r.stats.needVision, 2);
  assert.equal(r.stats.duplicateMirrors, 1);
  assert.deepEqual(r.propagate, [{ fromFileId: "m1", toLeafId: "copy", toFileId: "c1" }]);
});

test("既タグのコピーを代表に選び、再 vision せずミラーへ複製する", () => {
  // main/copy は同枚数。枚数だけで決めると辞書順で copy が代表になり m1 のタグを捨てて
  // 再 vision してしまう。既タグ優先のルールがそれを防ぐ。
  const byLeaf = {
    main: [{ id: "m1", title: "a.jpg" }],
    copy: [{ id: "c1", title: "a.jpg" }],
  };
  const r = planBatches({
    byLeaf,
    propertyOfLeaf: { main: "P", copy: "P" },
    taggedFileIds: new Set(["m1"]),
    batchSize: 24,
  });
  assert.equal(r.batches.length, 0, "既タグなので vision は不要");
  assert.deepEqual(r.propagate, [{ fromFileId: "m1", toLeafId: "copy", toFileId: "c1" }]);
});

test("resolveDuplicates は枚数が少なくても既タグ側を代表にする", () => {
  const byLeaf = {
    big: [{ id: "b1", title: "a.jpg" }, { id: "b2", title: "b.jpg" }],
    small: [{ id: "s1", title: "a.jpg" }],
  };
  const { canonicalOf, mirrorsOf } = resolveDuplicates({
    byLeaf,
    propertyOfLeaf: { big: "P", small: "P" },
    taggedFileIds: new Set(["s1"]),
  });
  assert.equal(canonicalOf.s1, true, "枚数では big が勝つが既タグの small を代表にする");
  assert.equal(canonicalOf.b1, undefined);
  assert.deepEqual(mirrorsOf.s1, [{ leafId: "big", fileId: "b1" }]);
});

test("planBatches は batchSize でリーフ内を分割する", () => {
  const files = Array.from({ length: 25 }, (_, i) => ({ id: "f" + i, title: i + ".jpg" }));
  const r = planBatches({ byLeaf: { L: files }, propertyOfLeaf: { L: "P" }, batchSize: 24 });
  assert.equal(r.batches.length, 2);
  assert.equal(r.batches[0].files.length, 24);
  assert.equal(r.batches[1].files.length, 1);
});
