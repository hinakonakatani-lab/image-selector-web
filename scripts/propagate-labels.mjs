// usage: node scripts/propagate-labels.mjs <propagateJsonPath>
//
// <propagateJsonPath> は [{ fromFileId, toLeafId, toFileId }, ...]。
// vision 済み(fromFileId)のラベルを読み、重複コピー(toFileId)に複製する。
// toLeafId ごとに readAllLabels→書込を1回ずつ、順次実行する（並列にしない）。
import { readFileSync } from "node:fs";
import { readAllLabels, writeLabels } from "./lib/redis.mjs";

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: node scripts/propagate-labels.mjs <propagateJsonPath>");
  process.exit(1);
}

const propagate = JSON.parse(readFileSync(path, "utf8"));
if (!Array.isArray(propagate)) {
  console.error("propagate は配列である必要があります");
  process.exit(1);
}

const all = await readAllLabels();
const labelByFileId = {};
for (const { fileId, label } of all) labelByFileId[fileId] = label;

const byLeaf = {};
for (const entry of propagate) {
  (byLeaf[entry.toLeafId] ??= []).push(entry);
}

let totalWritten = 0;
let totalMissing = 0;
for (const toLeafId of Object.keys(byLeaf).sort()) {
  const incoming = {};
  const missing = [];
  for (const { fromFileId, toFileId } of byLeaf[toLeafId]) {
    const label = labelByFileId[fromFileId];
    if (!label) { missing.push(fromFileId); continue; }
    incoming[toFileId] = label;
  }
  const count = Object.keys(incoming).length;
  if (count > 0) {
    await writeLabels(toLeafId, incoming);
    totalWritten += count;
  }
  if (missing.length > 0) {
    totalMissing += missing.length;
    console.log(`  警告: ${toLeafId} で元ラベル無し ${missing.length} 件: ${missing.join(", ")}`);
  }
  console.log(`OK: labels:shared:${toLeafId} に ${count} 件複製`);
}

console.log(`完了: 複製 ${totalWritten} 件 / 元ラベル無しでスキップ ${totalMissing} 件`);
