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

  for (const fileId of fileIds) {
    // ファイル名を取得
    const meta = await drive.files.get({ fileId, fields: "name" });
    const name = meta.data.name || fileId;

    // ファイル本体をダウンロード
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    zip.file(name, res.data as ArrayBuffer);
  }

  const zipBuffer = await zip.generateAsync({ type: "uint8array" });

  return new Response(zipBuffer.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="images.zip"',
    },
  });
}
