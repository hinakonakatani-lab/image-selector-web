// 表示に失敗したサムネイルをまとめて取り直すためのキュー。
//
// 失効したサムネイルは画面内で同時に何十枚も 403 になるので、1枚ずつリクエストすると
// 一気に数十本のリクエストが飛ぶ。短い待ち時間でまとめて1回にする。
// 一度取り直した fileId は再要求しない（取り直したURLでも表示できなかった場合に
// 無限に叩き続けるのを防ぐ）。

export type ThumbRefreshQueue = {
  enqueue(fileId: string): void;
};

export type ThumbStatus = "retrying" | "failed";

// サムネイルの表示に失敗したときの次の状態。
// キューは同じ fileId を二度リクエストしないので、取り直し済みのURLでも失敗したなら
// "retrying" のままにはできない（「読み込み中…」が永久に消えなくなる）。
export function nextThumbStatus(alreadyRefreshed: boolean): ThumbStatus {
  return alreadyRefreshed ? "failed" : "retrying";
}

export function createThumbRefreshQueue({
  fetchUrls,
  onResolved,
  schedule = (fn) => {
    setTimeout(fn, 300);
  },
}: {
  fetchUrls: (fileIds: string[]) => Promise<Record<string, string>>;
  onResolved: (urls: Record<string, string>) => void;
  schedule?: (fn: () => void) => void;
}): ThumbRefreshQueue {
  const requested = new Set<string>();
  let batch: string[] = [];
  let scheduled = false;

  const flush = async () => {
    scheduled = false;
    const ids = batch;
    batch = [];
    if (ids.length === 0) return;

    try {
      const urls = await fetchUrls(ids);
      if (Object.keys(urls).length > 0) onResolved(urls);
    } catch {
      // 取り直しに失敗しても、既存のプレースホルダー表示のまま何もしない。
    }
  };

  return {
    enqueue(fileId: string) {
      if (requested.has(fileId)) return;
      requested.add(fileId);
      batch.push(fileId);
      if (!scheduled) {
        scheduled = true;
        schedule(() => void flush());
      }
    },
  };
}
