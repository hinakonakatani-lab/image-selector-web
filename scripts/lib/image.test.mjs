import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downscale } from "./image.mjs";

test("downscale は長辺を縮小した画像を出力する", async () => {
  const dir = mkdtempSync(join(tmpdir(), "img-"));
  const src = join(dir, "src.png");
  // 2000x2000 の単色 PNG を sips で生成
  execFileSync("sips", ["-s", "format", "png", "-z", "2000", "2000", "/System/Library/CoreServices/DefaultDesktop.heic", "--out", src]);
  const out = await downscale(src, join(dir, "out.jpg"), 1024);
  assert.ok(existsSync(out));
  const dims = execFileSync("sips", ["-g", "pixelWidth", out]).toString();
  assert.match(dims, /pixelWidth: (\d+)/);
  const w = Number(dims.match(/pixelWidth: (\d+)/)[1]);
  assert.ok(w <= 1024, `width ${w} <= 1024`);
  assert.ok(statSync(out).size > 0);
});
