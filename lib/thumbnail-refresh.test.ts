import { test } from "node:test";
import assert from "node:assert/strict";
import {
  refreshThumbnails,
  withThumbnailSize,
  MAX_THUMB_REFRESH_IDS,
  type ThumbDriveLike,
} from "./thumbnail-refresh.ts";

function fakeDrive(links: Record<string, string | Error | null>) {
  let inFlight = 0;
  let maxInFlight = 0;
  const drive: ThumbDriveLike = {
    files: {
      async get({ fileId }) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        const v = links[fileId];
        if (v instanceof Error) throw v;
        return { data: { thumbnailLink: v } };
      },
    },
  };
  return { drive, maxInFlight: () => maxInFlight };
}

test("withThumbnailSize は末尾の=sNNを指定サイズに置き換える", () => {
  assert.equal(withThumbnailSize("https://lh3/x=s220", 300), "https://lh3/x=s300");
});

test("withThumbnailSize は=s220-c のような装飾付きも置き換える", () => {
  assert.equal(withThumbnailSize("https://lh3/x=s220-c", 300), "https://lh3/x=s300");
});

test("withThumbnailSize はサイズ指定が無ければ付与する", () => {
  assert.equal(withThumbnailSize("https://lh3/x", 300), "https://lh3/x=s300");
});

test("fileIdごとに取り直したサムネイルURLを返す", async () => {
  const { drive } = fakeDrive({ a: "https://lh3/a=s220", b: "https://lh3/b=s220" });

  const urls = await refreshThumbnails(drive, ["a", "b"]);

  assert.deepEqual(urls, { a: "https://lh3/a=s300", b: "https://lh3/b=s300" });
});

test("1件が失敗しても残りは返す", async () => {
  const { drive } = fakeDrive({
    a: "https://lh3/a=s220",
    b: new Error("File not found: b"),
    c: "https://lh3/c=s220",
  });

  const urls = await refreshThumbnails(drive, ["a", "b", "c"]);

  assert.deepEqual(urls, { a: "https://lh3/a=s300", c: "https://lh3/c=s300" });
});

test("thumbnailLink が空のファイルは結果に含めない", async () => {
  const { drive } = fakeDrive({ a: null, b: "https://lh3/b=s220" });

  const urls = await refreshThumbnails(drive, ["a", "b"]);

  assert.deepEqual(urls, { b: "https://lh3/b=s300" });
});

test("複数fileIdを並列に取得する", async () => {
  const links: Record<string, string> = {};
  for (let i = 0; i < 10; i++) links[`f${i}`] = `https://lh3/f${i}=s220`;
  const { drive, maxInFlight } = fakeDrive(links);

  await refreshThumbnails(drive, Object.keys(links));

  assert.ok(maxInFlight() >= 10, `並列に取得できていない（最大 ${maxInFlight()}）`);
});

test("上限を超えるfileIdは切り捨てる", async () => {
  const links: Record<string, string> = {};
  const ids: string[] = [];
  for (let i = 0; i < MAX_THUMB_REFRESH_IDS + 20; i++) {
    links[`f${i}`] = `https://lh3/f${i}=s220`;
    ids.push(`f${i}`);
  }
  const { drive } = fakeDrive(links);

  const urls = await refreshThumbnails(drive, ids);

  assert.equal(Object.keys(urls).length, MAX_THUMB_REFRESH_IDS);
});

test("fileIdが空なら1件もDriveを叩かない", async () => {
  let called = 0;
  const drive: ThumbDriveLike = {
    files: { async get() { called++; return { data: {} }; } },
  };

  const urls = await refreshThumbnails(drive, []);

  assert.deepEqual(urls, {});
  assert.equal(called, 0);
});
