// フォルダ構造キャッシュの鮮度判定。
//
// キャッシュには Drive の thumbnailLink（署名付きURL）がそのまま入っている。
// この URL は1時間未満で失効するので、キャッシュがそれより長生きすると
// 「フォルダ構成は出るが画像は全部403」という状態になる。
// Redis の TTL ではなく読み取り時に判定するのは、TTL 無しで書かれた既存のキャッシュ
// （最古で160日前）にも遡って効かせるため。

import type { WalkFolder } from "./drive-walk";

export type FolderCache = {
  folders: WalkFolder[];
  cachedAt: number;
};

// thumbnailLink の寿命（1時間未満）より短く取る。
export const THUMBNAIL_URL_MAX_AGE_MS = 30 * 60_000;

export function isFolderCacheFresh(
  cached: FolderCache | null | undefined,
  now: number
): boolean {
  if (!cached?.folders?.length) return false;
  if (typeof cached.cachedAt !== "number") return false;
  return now - cached.cachedAt <= THUMBNAIL_URL_MAX_AGE_MS;
}
