import { test } from "node:test";
import assert from "node:assert/strict";
import { isFolderCacheFresh, THUMBNAIL_URL_MAX_AGE_MS } from "./folder-cache.ts";

const NOW = Date.parse("2026-08-28T12:00:00+09:00");
const cacheAgedMinutes = (min: number) => ({
  folders: [{ id: "f", name: "n", path: "n", images: [{ id: "a", name: "a", thumbnailUrl: "u", webViewLink: "w" }] }],
  cachedAt: NOW - min * 60_000,
});

test("取得直後のキャッシュは使える", () => {
  assert.equal(isFolderCacheFresh(cacheAgedMinutes(0), NOW), true);
});

test("上限より新しいキャッシュは使える", () => {
  assert.equal(isFolderCacheFresh(cacheAgedMinutes(29), NOW), true);
});

test("サムネイルURLの寿命を超えたキャッシュは使わない", () => {
  // Drive の thumbnailLink は1時間未満で失効するため、古いキャッシュを配ると
  // 画像枠が全部 403 になる（実測: 5時間前のキャッシュで30枚中30枚が失効）。
  assert.equal(isFolderCacheFresh(cacheAgedMinutes(31), NOW), false);
});

test("42日前のキャッシュは使わない", () => {
  assert.equal(isFolderCacheFresh(cacheAgedMinutes(42 * 24 * 60), NOW), false);
});

test("上限はサムネイルの寿命（1時間）より短い", () => {
  assert.ok(
    THUMBNAIL_URL_MAX_AGE_MS < 60 * 60_000,
    "サムネイルが失効するより前にキャッシュを捨てないと意味がない"
  );
});

test("cachedAt が無い旧形式のキャッシュは使わない", () => {
  const legacy = { folders: cacheAgedMinutes(0).folders } as never;
  assert.equal(isFolderCacheFresh(legacy, NOW), false);
});

test("キャッシュが無い場合は使わない", () => {
  assert.equal(isFolderCacheFresh(null, NOW), false);
  assert.equal(isFolderCacheFresh(undefined, NOW), false);
});

test("フォルダが空のキャッシュは使わない", () => {
  assert.equal(isFolderCacheFresh({ folders: [], cachedAt: NOW }, NOW), false);
});
