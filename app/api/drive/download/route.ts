import { auth } from "@/auth";
import { google } from "googleapis";
import JSZip from "jszip";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return new Response(JSON.stringify({ error: "未ログイン" }), { status: 401 });
  }

  const { fileIds } = await request.json() as { fileIds: string[] };
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return new Response(JSON.stringify({ error: "fileIdsが必要です" }), { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  const zip = new JSZip();

  await Promise.all(fileIds.map(async (fileId) => {
    // ファイル名を取得（共有ドライブ対応）
    const meta = await drive.files.get({
      fileId,
      fields: "name",
      supportsAllDrives: true,
    });
    const name = meta.data.name || fileId;

    // ファイル本体をダウンロード（共有ドライブ対応）
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );

    const data = res.data as ArrayBuffer | Buffer;
    zip.file(name, Buffer.isBuffer(data) ? data : Buffer.from(data));
  }));

  const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });
  const zipBlob = new Blob([zipBuffer], { type: "application/zip" });

  return new Response(zipBlob, {
    headers: {
      "Content-Disposition": 'attachment; filename="images.zip"',
    },
  });
}
