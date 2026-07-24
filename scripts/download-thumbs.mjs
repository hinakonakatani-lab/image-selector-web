// usage: node scripts/download-thumbs.mjs <outDir> [size]   (stdin に fileId の配列 JSON)
// thumbnailLink をダウンロード直前に取り直してから複数枚を一括ダウンロードする
// （thumbnailLinkは署名付きURLで短時間で失効するため、事前列挙時の値は使い回せない）。
// コマンド形自体は常に同じなので、1回許可すればバッチごとにcurlを個別承認する必要が無くなる。
// size省略時は1024（長辺ピクセル）。
import { driveClient } from "./lib/drive-client.mjs";
import { fetchThumbnailLinks, downloadThumbs } from "./lib/download-thumbs.mjs";

const outDir = process.argv[2];
if (!outDir) { console.error("outDir が必要です"); process.exit(1); }
const size = process.argv[3] ? Number(process.argv[3]) : 1024;

let input = "";
for await (const chunk of process.stdin) input += chunk;
const fileIds = JSON.parse(input);

const drive = driveClient();
const getLink = async (fileId) => {
  const res = await drive.files.get({ fileId, fields: "thumbnailLink", supportsAllDrives: true });
  return res.data.thumbnailLink;
};

const { links, failed: linkFailed } = await fetchThumbnailLinks(fileIds, { getLink });
const entries = Object.entries(links).map(([fileId, url]) => ({ fileId, url }));
const { saved, failed: dlFailed } = await downloadThumbs(entries, outDir, { size });
const failed = { ...linkFailed, ...dlFailed };

console.error(`保存: ${Object.keys(saved).length} 件 / 失敗: ${Object.keys(failed).length} 件`);
process.stdout.write(JSON.stringify({ saved, failed }, null, 2));
if (Object.keys(failed).length > 0) process.exitCode = 1;
