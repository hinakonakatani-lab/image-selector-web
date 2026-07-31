// バッチ計画の純ロジック（env 不要・Drive/Redis に触らない）
//
// 目的: 大量画像のタグ付けを「vision が必要な分」と「ラベルを複製するだけで済む分」に分け、
// 冪等（既タグはスキップ）・安全（NG除外）・無駄なし（重複コピーは1回だけ vision）にする。

/** macOS の AppleDouble 残骸（`._` 接頭辞）。実画像ではないので常に除外する。 */
export const isAppleDoubleName = (title) => typeof title === "string" && title.startsWith("._");

/** 同一ファイル判定に使う正規化名。拡張子は残す（`x.JPG` と `x-HDR.JPG` は別画像）。 */
export const normalizeName = (title) => String(title ?? "").toLowerCase();

/**
 * プロパティ（物件）単位で、同名ファイルが複数リーフに存在する重複を検出する。
 *
 * 代表（canonical）の優先順位:
 *   1. 既にタグ済みのコピー — 済んでいる仕事をやり直さないため
 *   2. そのプロパティ内で画像数が最も多いリーフ — 主フォルダである可能性が高い
 *   3. leafId の辞書順 — 実行ごとに結果が変わらないようにする
 *
 * 別プロパティ間は照合しない。別物件でカメラの連番が偶然一致することがあるため。
 */
export function resolveDuplicates({ byLeaf, propertyOfLeaf, taggedFileIds = new Set() }) {
  const leafSize = {};
  for (const [leafId, files] of Object.entries(byLeaf)) leafSize[leafId] = files.length;

  // property -> name -> [{leafId, fileId, title}]
  const groups = {};
  for (const [leafId, files] of Object.entries(byLeaf)) {
    const prop = propertyOfLeaf[leafId] ?? leafId;
    for (const f of files) {
      const key = normalizeName(f.title);
      ((groups[prop] ??= {})[key] ??= []).push({ leafId, fileId: f.id, title: f.title });
    }
  }

  const canonicalOf = {}; // fileId -> true（代表として vision する対象）
  const mirrorsOf = {}; // 代表 fileId -> [{leafId, fileId}]

  for (const byName of Object.values(groups)) {
    for (const occurrences of Object.values(byName)) {
      const sorted = [...occurrences].sort((a, b) => {
        const tagged = Number(taggedFileIds.has(b.fileId)) - Number(taggedFileIds.has(a.fileId));
        if (tagged !== 0) return tagged;
        const d = (leafSize[b.leafId] ?? 0) - (leafSize[a.leafId] ?? 0);
        return d !== 0 ? d : a.leafId < b.leafId ? -1 : a.leafId > b.leafId ? 1 : 0;
      });
      const [head, ...rest] = sorted;
      canonicalOf[head.fileId] = true;
      if (rest.length > 0) {
        mirrorsOf[head.fileId] = rest.map((r) => ({ leafId: r.leafId, fileId: r.fileId }));
      }
    }
  }
  return { canonicalOf, mirrorsOf };
}

export function chunk(items, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error("size は1以上の整数");
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * @param {object} p
 * @param {Record<string, {id:string,title:string}[]>} p.byLeaf リーフID -> 画像
 * @param {Record<string,string>} p.propertyOfLeaf リーフID -> プロパティ（重複照合の範囲）
 * @param {Set<string>} p.taggedFileIds 既にタグ済みの fileId（冪等スキップ用）
 * @param {Set<string>} p.ngFileIds グレー(NG)判定された fileId
 * @param {number} p.batchSize
 * @returns {{batches:{leafId:string,files:{id:string,title:string}[]}[],
 *            propagate:{fromFileId:string,toLeafId:string,toFileId:string}[],
 *            stats:object}}
 */
export function planBatches({ byLeaf, propertyOfLeaf = {}, taggedFileIds = new Set(), ngFileIds = new Set(), batchSize = 24 }) {
  const stats = { totalImages: 0, appleDouble: 0, ng: 0, duplicateMirrors: 0, alreadyTagged: 0, needVision: 0, propagateOnly: 0 };

  // AppleDouble と NG を先に落とす（重複判定にも混ぜない）
  const cleanByLeaf = {};
  for (const [leafId, files] of Object.entries(byLeaf)) {
    const kept = [];
    for (const f of files) {
      stats.totalImages++;
      if (isAppleDoubleName(f.title)) { stats.appleDouble++; continue; }
      if (ngFileIds.has(f.id)) { stats.ng++; continue; }
      kept.push(f);
    }
    if (kept.length > 0) cleanByLeaf[leafId] = kept;
  }

  const { canonicalOf, mirrorsOf } = resolveDuplicates({ byLeaf: cleanByLeaf, propertyOfLeaf, taggedFileIds });

  // 代表のうち未タグのものだけ vision する
  const needVisionByLeaf = {};
  for (const [leafId, files] of Object.entries(cleanByLeaf)) {
    for (const f of files) {
      if (!canonicalOf[f.id]) { stats.duplicateMirrors++; continue; }
      if (taggedFileIds.has(f.id)) { stats.alreadyTagged++; continue; }
      (needVisionByLeaf[leafId] ??= []).push(f);
      stats.needVision++;
    }
  }

  // ミラーは vision せずラベルを複製する（代表が既タグでも今回タグ付けでも同じ扱い）
  const propagate = [];
  for (const [fromFileId, mirrors] of Object.entries(mirrorsOf)) {
    for (const m of mirrors) {
      if (taggedFileIds.has(m.fileId)) continue; // 既に入っているものは触らない
      propagate.push({ fromFileId, toLeafId: m.leafId, toFileId: m.fileId });
    }
  }
  stats.propagateOnly = propagate.length;

  const batches = [];
  for (const leafId of Object.keys(needVisionByLeaf).sort()) {
    for (const files of chunk(needVisionByLeaf[leafId], batchSize)) batches.push({ leafId, files });
  }

  return { batches, propagate, stats };
}
