import { auth } from "@/auth";
import { google } from "googleapis";
import { NextResponse } from "next/server";

export type DriveImage = {
  id: string;
  name: string;
  thumbnailUrl: string;
  webViewLink: string;
};

export type DriveFolder = {
  id: string;
  name: string;
  path: string;
  images: DriveImage[];
};

// フォルダIDを受け取って画像一覧を返す
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  try {
    const folders = await getFoldersWithImages(drive, folderId, "");
    return NextResponse.json({ folders });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "不明なエラー";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function getFoldersWithImages(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  parentPath: string
): Promise<DriveFolder[]> {
  const folderName = await getFolderName(drive, folderId);
  const currentPath = parentPath ? `${parentPath} / ${folderName}` : folderName;

  // 画像ファイルを取得
  const imagesRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: "files(id, name, thumbnailLink, webViewLink)",
    pageSize: 1000,
  });

  const images: DriveImage[] = (imagesRes.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
    thumbnailUrl: f.thumbnailLink?.replace("=s220", "=s300") || "",
    webViewLink: f.webViewLink!,
  }));

  const result: DriveFolder[] = [];
  if (images.length > 0) {
    result.push({ id: folderId, name: folderName, path: currentPath, images });
  }

  // サブフォルダを再帰的に処理
  const subFoldersRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 100,
  });

  for (const sub of subFoldersRes.data.files || []) {
    const subFolders = await getFoldersWithImages(drive, sub.id!, currentPath);
    result.push(...subFolders);
  }

  return result;
}

async function getFolderName(
  drive: ReturnType<typeof google.drive>,
  folderId: string
): Promise<string> {
  const res = await drive.files.get({
    fileId: folderId,
    fields: "name",
  });
  return res.data.name || folderId;
}
