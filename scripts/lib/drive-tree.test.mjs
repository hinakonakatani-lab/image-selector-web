import { test } from "node:test";
import assert from "node:assert/strict";
import { isFolder, isImage, splitChildren, groupImagesByLeaf } from "./drive-tree.mjs";

const folder = { id: "f1", mimeType: "application/vnd.google-apps.folder", title: "5月", parentId: "root" };
const img1 = { id: "i1", mimeType: "image/jpeg", title: "a.jpg", parentId: "f1" };
const img2 = { id: "i2", mimeType: "image/png", title: "b.png", parentId: "f1" };
const img3 = { id: "i3", mimeType: "image/jpeg", title: "c.jpg", parentId: "f2" };

test("種別判定", () => {
  assert.equal(isFolder(folder), true);
  assert.equal(isImage(img1), true);
  assert.equal(isImage(folder), false);
});

test("splitChildren は folders と images に分ける", () => {
  const { folders, images } = splitChildren([folder, img1, img2]);
  assert.equal(folders.length, 1);
  assert.equal(images.length, 2);
});

test("groupImagesByLeaf は parentId ごとにまとめる", () => {
  const g = groupImagesByLeaf([img1, img2, img3]);
  assert.equal(g["f1"].length, 2);
  assert.equal(g["f2"].length, 1);
  assert.equal(g["f1"][0].title, "a.jpg");
});
