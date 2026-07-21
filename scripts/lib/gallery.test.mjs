import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGallery } from "./gallery.mjs";

test("HTML にテーマ・件数・タイルが含まれる", () => {
  const html = renderGallery("明るいリビング", [
    { fileId: "i1", title: "a.jpg", thumbPath: "thumbs/i1.jpg", viewUrl: "https://drive/i1", label: { place: "リビング", scene: "屋内" } },
  ]);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /明るいリビング/);
  assert.match(html, /1\s*件/);
  assert.match(html, /thumbs\/i1\.jpg/);
  assert.match(html, /https:\/\/drive\/i1/);
  assert.match(html, /リビング/);
});

test("HTML エスケープでタグ流し込みを防ぐ", () => {
  const html = renderGallery("<script>x</script>", []);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});
