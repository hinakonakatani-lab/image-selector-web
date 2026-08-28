// 失効したサムネイルURLを、その場で取り直す。
//
// Drive の thumbnailLink は1時間未満で失効する署名付きURL。
// 画面を開いたまま時間が経つと、遅延読み込み（loading="lazy"）で後から表示される画像だけ
// 403 になる。失敗した画像の fileId だけを受け取って取り直すので、
// フォルダ全体を再走査せずに済む。

export const MAX_THUMB_REFRESH_IDS = 200;

export type ThumbDriveLike = {
  files: {
    get(params: {
      fileId: string;
      fields: string;
      supportsAllDrives?: boolean;
    }): Promise<{ data: { thumbnailLink?: string | null } }>;
  };
};

// 末尾の =sNN（=s220-c のような装飾付きを含む）を指定サイズへ揃える。
export function withThumbnailSize(link: string, size: number): string {
  return /=s\d+(-[a-z0-9]+)*$/i.test(link)
    ? link.replace(/=s\d+(-[a-z0-9]+)*$/i, `=s${size}`)
    : `${link}=s${size}`;
}

export async function refreshThumbnails(
  drive: ThumbDriveLike,
  fileIds: string[],
  size = 300
): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};

  // 1件の失敗が他を巻き込まないよう、個別に握って落とす。
  await Promise.all(
    fileIds.slice(0, MAX_THUMB_REFRESH_IDS).map(async (fileId) => {
      try {
        const res = await drive.files.get({
          fileId,
          fields: "thumbnailLink",
          supportsAllDrives: true,
        });
        const link = res.data.thumbnailLink;
        if (link) urls[fileId] = withThumbnailSize(link, size);
      } catch {
        // 権限が無い・削除済みなど。その画像は諦めて他を返す。
      }
    })
  );

  return urls;
}
