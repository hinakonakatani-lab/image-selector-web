import { auth } from "@/auth";
import { google } from "googleapis";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return new Response(JSON.stringify({ error: "未ログイン" }), { status: 401 });
  }

  const { fileId } = await request.json() as { fileId: string };
  if (!fileId) {
    return new Response(JSON.stringify({ error: "fileIdが必要です" }), { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  try {
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

    const data = res.data as ArrayBuffer;
    const blob = new Blob([data]);

    return new Response(blob, {
      headers: {
        "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[download] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
