// usage: node scripts/merge-and-write.mjs <leafFolderId> <dir>
//
// <dir> 内の *.json（1バッチ=1ファイル、中身は { fileId: label }）をマージし、
// そのリーフに対して **1回だけ** 書込む。
//
// なぜ1回だけか: /api/labels-shared の POST は read-modify-write（get → merge → set）で
// アトミックでないため、同一 folderId へ並列に書くと lost update が起きる。
// 実測: 同一キーへ8件を並列投入 → 2件しか残らなかった。
// したがってタグ付けエージェントには Redis を直接書かせず、ファイルに出させて
// リーフ単位でこのスクリプトを順次実行する。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeLabels } from "./lib/redis.mjs";
import { validateLabel } from "./lib/tag-schema.mjs";

const [leafFolderId, dir] = process.argv.slice(2);
if (!leafFolderId || !dir) {
  console.error("usage: node scripts/merge-and-write.mjs <leafFolderId> <dir>");
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
if (files.length === 0) {
  console.error(`${dir} に *.json がありません`);
  process.exit(1);
}

const merged = {};
const rejected = [];
let duplicates = 0;

for (const f of files) {
  const path = join(dir, f);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    rejected.push({ file: f, fileId: "-", errors: [`JSON 不正: ${e.message}`] });
    continue;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    rejected.push({ file: f, fileId: "-", errors: ["トップレベルがオブジェクトでない"] });
    continue;
  }
  for (const [fileId, label] of Object.entries(parsed)) {
    const { ok, errors } = validateLabel(label ?? {});
    if (!ok) { rejected.push({ file: f, fileId, errors }); continue; }
    if (!label.scene) { rejected.push({ file: f, fileId, errors: ["scene が空（未タグ扱いになる）"] }); continue; }
    if (fileId in merged) duplicates++;
    merged[fileId] = label;
  }
}

const count = Object.keys(merged).length;
if (count === 0) {
  console.error("書込対象が0件です（全件が検証で落ちました）");
  for (const r of rejected) console.error(`  NG ${r.file} / ${r.fileId}: ${r.errors.join(", ")}`);
  process.exit(1);
}

await writeLabels(leafFolderId, merged);

console.log(`OK: ${count} 件を labels:shared:${leafFolderId} に書込（${files.length} ファイルをマージ）`);
if (duplicates > 0) console.log(`  情報: 同一 fileId の重複 ${duplicates} 件（後勝ちで採用）`);
if (rejected.length > 0) {
  console.log(`  警告: 検証で除外 ${rejected.length} 件`);
  for (const r of rejected) console.log(`    NG ${r.file} / ${r.fileId}: ${r.errors.join(", ")}`);
}
