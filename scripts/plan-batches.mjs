// usage: node scripts/plan-batches.mjs <rootFolderId> [--batch-size 24] [--out plan.json]
//
// Drive ツリーを走査し、タグ付けのバッチ計画を出力する。
//   - 既タグはスキップ（冪等：再実行すると増えた分だけ処理される）
//   - グレー(NG)判定の画像は除外
//   - AppleDouble 残骸（`._` 接頭辞）は除外
//   - 同一物件内の同名ファイル（軽量版コピー等）は 1 枚だけ vision し、
//     残りは propagate（ラベル複製）に回す＝再認識のコストを払わない
//
// 出力した plan.json の batches を 1 件ずつタグ付けエージェントに渡し、結果は
// リーフごとのディレクトリに JSON で出させて、最後に merge-and-write.mjs で書き込む。
// （エージェントに Redis を直接書かせてはいけない。理由は merge-and-write.mjs の冒頭参照）
import { writeFileSync } from "node:fs";
import { splitChildren } from "./lib/drive-tree.mjs";
import { driveClient } from "./lib/drive-client.mjs";
import { planBatches } from "./lib/batch-plan.mjs";
import { readAllLabels } from "./lib/redis.mjs";
import { getBaseUrl, getToken } from "./lib/api-config.mjs";
import { buildReadRequest, parseItemsResponse } from "./lib/colors-api.mjs";
import { isTagged } from "./lib/tag-schema.mjs";

const NG_COLOR = "#999999"; // アプリの「グレー（NG）」

const args = process.argv.slice(2);
const rootFolderId = args[0];
if (!rootFolderId) {
  console.error("usage: node scripts/plan-batches.mjs <rootFolderId> [--batch-size 24] [--out plan.json]");
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const batchSize = Number(flag("--batch-size", "24"));
const outPath = flag("--out", "plan.json");
if (!Number.isInteger(batchSize) || batchSize < 1) {
  console.error("--batch-size は1以上の整数");
  process.exit(1);
}

async function listChildren(drive, parentId) {
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType)",
      pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) files.push({ id: f.id, title: f.name, mimeType: f.mimeType, parentId });
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

/** ルート直下の子フォルダを「物件（プロパティ）」として扱い、各リーフの所属を決める。 */
async function walk(drive, rootId) {
  const byLeaf = {};
  const propertyOfLeaf = {};
  const queue = [{ id: rootId, property: null }];
  while (queue.length) {
    const { id, property } = queue.shift();
    const { folders, images } = splitChildren(await listChildren(drive, id));
    if (images.length > 0) {
      byLeaf[id] = images.map((i) => ({ id: i.id, title: i.title }));
      propertyOfLeaf[id] = property ?? id;
    }
    for (const f of folders) queue.push({ id: f.id, property: property ?? f.id });
  }
  return { byLeaf, propertyOfLeaf };
}

async function readNgFileIds() {
  const { url, options } = buildReadRequest(getBaseUrl(), getToken());
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`色データ読取API失敗: ${res.status} ${await res.text()}`);
  const items = parseItemsResponse(await res.json());
  // 色は「エディターが開いたフォルダ」単位で保存されるためリーフ単位とは一致しない。
  // fileId は Drive 全体で一意なので、どのキーに入っていても NG として扱う。
  return new Set(items.filter((i) => i.color === NG_COLOR).map((i) => i.fileId));
}

const drive = driveClient();
const [{ byLeaf, propertyOfLeaf }, labelItems, ngFileIds] = await Promise.all([
  walk(drive, rootFolderId),
  readAllLabels(),
  readNgFileIds(),
]);

const taggedFileIds = new Set(labelItems.filter((i) => isTagged(i.label)).map((i) => i.fileId));

const { batches, propagate, stats } = planBatches({ byLeaf, propertyOfLeaf, taggedFileIds, ngFileIds, batchSize });

writeFileSync(outPath, JSON.stringify({ rootFolderId, batchSize, stats, batches, propagate }, null, 2));

console.log(`計画を ${outPath} に出力`);
console.log(`  総画像 ${stats.totalImages} / 除外: AppleDouble ${stats.appleDouble}・NG ${stats.ng}・重複コピー ${stats.duplicateMirrors}・既タグ ${stats.alreadyTagged}`);
console.log(`  vision が必要 ${stats.needVision} 枚 → ${batches.length} バッチ（${batchSize}枚/バッチ）`);
console.log(`  ラベル複製のみ ${stats.propagateOnly} 枚（vision 不要）`);
