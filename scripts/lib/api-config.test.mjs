import { test } from "node:test";
import assert from "node:assert/strict";
import { getBaseUrl, parseGoogleCreds } from "./api-config.mjs";

test("getBaseUrl は env から取得", () => {
  assert.equal(getBaseUrl({ LABELS_API_BASE: "https://x.example" }), "https://x.example");
});
test("未設定は例外", () => {
  assert.throws(() => getBaseUrl({}), /LABELS_API_BASE/);
});
test("http(s) でないURLは例外", () => {
  assert.throws(() => getBaseUrl({ LABELS_API_BASE: "ftp://x" }), /http/);
});

test("parseGoogleCreds は clientId/clientSecret/refreshToken を返す", () => {
  const c = parseGoogleCreds('{"clientId":"a","clientSecret":"b","refreshToken":"c"}');
  assert.deepEqual(c, { clientId: "a", clientSecret: "b", refreshToken: "c" });
});
test("parseGoogleCreds: 不正JSONは例外", () => {
  assert.throws(() => parseGoogleCreds("nope"), /JSON/);
});
test("parseGoogleCreds: 項目欠落は例外", () => {
  assert.throws(() => parseGoogleCreds('{"clientId":"a"}'), /clientId|clientSecret|refreshToken/);
});
