// Google Drive のフォルダツリーを辿って、画像を持つフォルダの一覧を作る。
//
// 逐次に辿るとフォルダ数ぶんの往復がそのまま待ち時間になり（実測: 73フォルダで95秒）、
// サーバーレス関数の実行時間上限に届いてキャッシュ更新まで到達できなくなる。
// 同一フォルダの「画像一覧」と「サブフォルダ一覧」、および兄弟フォルダを並列に取得して、
// 所要時間をフォルダ数ではなく階層の深さに比例させる。

export type WalkImage = {
  id: string;
  name: string;
  thumbnailUrl: string;
  webViewLink: string;
};

export type WalkFolder = {
  id: string;
  name: string;
  path: string;
  images: WalkImage[];
};

type DriveFile = {
  id?: string | null;
  name?: string | null;
  thumbnailLink?: string | null;
  webViewLink?: string | null;
};

export type DriveLike = {
  files: {
    get(params: {
      fileId: string;
      fields: string;
      supportsAllDrives?: boolean;
    }): Promise<{ data: { name?: string | null } }>;
    list(params: {
      q: string;
      fields: string;
      pageSize: number;
      supportsAllDrives?: boolean;
      includeItemsFromAllDrives?: boolean;
    }): Promise<{ data: { files?: DriveFile[] | null } }>;
  };
};

const imageQuery = (folderId: string) =>
  `'${folderId}' in parents and mimeType contains 'image/' and not mimeType = 'image/vnd.adobe.photoshop' and trashed = false`;

const folderQuery = (folderId: string) =>
  `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

export async function walkFolders(
  drive: DriveLike,
  rootFolderId: string
): Promise<WalkFolder[]> {
  const res = await drive.files.get({
    fileId: rootFolderId,
    fields: "name",
    supportsAllDrives: true,
  });
  return walk(drive, rootFolderId, res.data.name || rootFolderId, "");
}

async function walk(
  drive: DriveLike,
  folderId: string,
  name: string,
  parentPath: string
): Promise<WalkFolder[]> {
  const path = parentPath ? `${parentPath} / ${name}` : name;

  const [imagesRes, subRes] = await Promise.all([
    drive.files.list({
      q: imageQuery(folderId),
      fields: "files(id, name, thumbnailLink, webViewLink)",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }),
    drive.files.list({
      q: folderQuery(folderId),
      fields: "files(id, name)",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }),
  ]);

  const images: WalkImage[] = (imagesRes.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
    thumbnailUrl: f.thumbnailLink?.replace("=s220", "=s300") || "",
    webViewLink: f.webViewLink!,
  }));

  const self: WalkFolder[] = images.length > 0 ? [{ id: folderId, name, path, images }] : [];

  // 子フォルダの名前は一覧に含まれているので、フォルダごとの files.get は不要。
  const subs = await Promise.all(
    (subRes.data.files || []).map((sub) =>
      walk(drive, sub.id!, sub.name || sub.id!, path)
    )
  );

  return [...self, ...subs.flat()];
}
