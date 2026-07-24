import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toThumbUrl, downloadThumbs, fetchThumbnailLinks } from "./download-thumbs.mjs";

test("toThumbUrl は末尾の=sNNをサイズ指定で置き換える", () => {
  assert.equal(
    toThumbUrl("https://example.com/foo=s220", 1024),
    "https://example.com/foo=s1024"
  );
});

test("toThumbUrl はサイズ指定が無ければ末尾に付与する", () => {
  assert.equal(toThumbUrl("https://example.com/foo", 1024), "https://example.com/foo=s1024");
});

test("downloadThumbs は各URLを<fileId>.jpgとして保存する", async () => {
  const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
  const fetchImpl = async (url) => ({
    ok: true,
    arrayBuffer: async () => Buffer.from(`content-for-${url}`),
  });
  const { saved, failed } = await downloadThumbs(
    [
      { fileId: "a", url: "https://example.com/a=s220" },
      { fileId: "b", url: "https://example.com/b=s220" },
    ],
    dir,
    { fetchImpl }
  );
  assert.deepEqual(failed, {});
  assert.equal(Object.keys(saved).length, 2);
  assert.ok(existsSync(saved.a));
  assert.match(readFileSync(saved.a, "utf8"), /a=s1024/);
});

test("downloadThumbs は失敗したファイルだけfailedに記録し、他は続行する", async () => {
  const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
  const fetchImpl = async (url) => {
    if (url.includes("bad")) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => Buffer.from("ok") };
  };
  const { saved, failed } = await downloadThumbs(
    [
      { fileId: "good", url: "https://example.com/good=s220" },
      { fileId: "bad", url: "https://example.com/bad=s220" },
    ],
    dir,
    { fetchImpl }
  );
  assert.equal(Object.keys(saved).length, 1);
  assert.ok(saved.good);
  assert.match(failed.bad, /404/);
});

test("fetchThumbnailLinks は各fileIdについて新しいリンクを取得する", async () => {
  const getLink = async (fileId) => `https://example.com/${fileId}=s220`;
  const { links, failed } = await fetchThumbnailLinks(["a", "b"], { getLink });
  assert.deepEqual(failed, {});
  assert.equal(links.a, "https://example.com/a=s220");
  assert.equal(links.b, "https://example.com/b=s220");
});

test("fetchThumbnailLinks は失敗したfileIdだけfailedに記録し、他は続行する", async () => {
  const getLink = async (fileId) => {
    if (fileId === "bad") throw new Error("not found");
    return `https://example.com/${fileId}=s220`;
  };
  const { links, failed } = await fetchThumbnailLinks(["good", "bad"], { getLink });
  assert.equal(links.good, "https://example.com/good=s220");
  assert.equal(links.bad, undefined);
  assert.match(failed.bad, /not found/);
});
