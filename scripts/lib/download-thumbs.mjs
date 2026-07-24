import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Drive の thumbnailLink 末尾の =sNN を =s{size} に置き換える（無ければ付与する）
export function toThumbUrl(link, size = 1024) {
  return /=s\d+(-[a-z0-9]+)*$/i.test(link)
    ? link.replace(/=s\d+(-[a-z0-9]+)*$/i, `=s${size}`)
    : `${link}=s${size}`;
}

// thumbnailLink は署名付きURLで数時間ではなく短時間（1h未満）で失効するため、
// ダウンロード直前に取り直す。1件の失敗が全体を止めないよう個別に集計する。
export async function fetchThumbnailLinks(fileIds, { getLink }) {
  const links = {};
  const failed = {};
  await Promise.all(
    fileIds.map(async (fileId) => {
      try {
        const link = await getLink(fileId);
        if (!link) throw new Error("thumbnailLink が空です");
        links[fileId] = link;
      } catch (err) {
        failed[fileId] = String(err.message ?? err);
      }
    })
  );
  return { links, failed };
}

// entries: [{fileId, url}] を outDir に <fileId>.jpg として並行ダウンロードする。
// 1件の失敗が全体を止めないよう、成否を集計して返す。
export async function downloadThumbs(entries, outDir, { fetchImpl = fetch, size = 1024 } = {}) {
  await mkdir(outDir, { recursive: true });
  const saved = {};
  const failed = {};
  await Promise.all(
    entries.map(async ({ fileId, url }) => {
      try {
        const res = await fetchImpl(toThumbUrl(url, size));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const outPath = join(outDir, `${fileId}.jpg`);
        await writeFile(outPath, buf);
        saved[fileId] = outPath;
      } catch (err) {
        failed[fileId] = String(err.message ?? err);
      }
    })
  );
  return { saved, failed };
}
