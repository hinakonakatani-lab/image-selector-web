import { auth } from "@/auth";
import { google } from "googleapis";
import JSZip from "jszip";

type ZipFileRequest = { fileId: string; name?: string; folderLabel?: string };

const CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return new Response(JSON.stringify({ error: "未ログイン" }), { status: 401 });
  }

  const { files } = (await request.json()) as { files: ZipFileRequest[] };
  if (!files || files.length === 0) {
    return new Response(JSON.stringify({ error: "filesが必要です" }), { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  const zip = new JSZip();
  let failedCount = 0;

  await mapWithConcurrency(files, CONCURRENCY, async (file) => {
    try {
      const meta = await drive.files.get({
        fileId: file.fileId,
        fields: "name",
        supportsAllDrives: true,
      });
      const originalName = meta.data.name || file.fileId;
      const dotIndex = originalName.lastIndexOf(".");
      const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : "";
      const baseName = file.name ? `${file.name}${ext}` : originalName;

      const res = await drive.files.get(
        { fileId: file.fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" }
      );
      const data = res.data as ArrayBuffer;

      const path = file.folderLabel ? `${file.folderLabel}/${baseName}` : baseName;
      zip.file(path, data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[download-zip] failed:", file.fileId, message);
      failedCount++;
    }
  });

  if (failedCount === files.length) {
    return new Response(JSON.stringify({ error: "全てのファイルの取得に失敗しました" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const buffer = await zip.generateAsync({ type: "arraybuffer" });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="images.zip"`,
      "X-Failed-Count": String(failedCount),
    },
  });
}
