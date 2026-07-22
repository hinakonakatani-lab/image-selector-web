import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReadRequest, buildWriteRequest, parseItemsResponse } from "./labels-api.mjs";

test("buildReadRequest は GET と Bearer を組む", () => {
  const { url, options } = buildReadRequest("https://x.example", "TKN");
  assert.equal(url, "https://x.example/api/labels-shared");
  assert.equal(options.method, "GET");
  assert.equal(options.headers.Authorization, "Bearer TKN");
});

test("buildReadRequest は baseUrl 末尾スラッシュを正規化", () => {
  const { url } = buildReadRequest("https://x.example/", "TKN");
  assert.equal(url, "https://x.example/api/labels-shared");
});

test("buildWriteRequest は POST・JSON body を組む", () => {
  const labels = { i1: { scene: "屋内" } };
  const { url, options } = buildWriteRequest("https://x.example", "TKN", "F1", labels);
  assert.equal(url, "https://x.example/api/labels-shared");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer TKN");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), { folderId: "F1", labels });
});

test("parseItemsResponse は items 配列を返す／不正は例外", () => {
  assert.deepEqual(parseItemsResponse({ items: [{ folderId: "F", fileId: "i", label: {} }] }),
    [{ folderId: "F", fileId: "i", label: {} }]);
  assert.deepEqual(parseItemsResponse({}), []);
  assert.throws(() => parseItemsResponse({ items: "nope" }));
});
