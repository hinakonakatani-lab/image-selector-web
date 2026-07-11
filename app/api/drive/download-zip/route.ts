import { auth } from "@/auth";
import { google } from "googleapis";
import JSZip from "jszip";

// この関数の実行時間上限を伸ばす（プランの上限が優先されるが、既定より長く許可する）。
// メモリ割り当てはvercel.jsonの functions 設定側で行う。
export const maxDuration = 60;

type ZipFileRequest = { fileId: string; name?: string; folderLabel?: string };

// 以前は8並列だった。並列数が多いほど、同時にメモリへ保持する画像バッファが
// 増えピークメモリが上がるため、OOM対策として引き下げている。
const CONCURRENCY = 3;

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

// Ensures each zip entry path is unique within a request. If `path` was
// already used, appends a " (2)", " (3)", ... suffix before the file
// extension (and after any folder prefix) until an unused path is found.
// Synchronous check-then-insert on a shared Set is safe here because
// mapWithConcurrency never awaits between computing the path and calling
// this function, so there is no interleaving between concurrent files.
function dedupePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
  const fileName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dotIndex = fileName.lastIndexOf(".");
  const base = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex) : "";

  let counter = 2;
  let candidate = `${dir}${base} (${counter})${ext}`;
  while (usedPaths.has(candidate)) {
    counter++;
    candidate = `${dir}${base} (${counter})${ext}`;
  }
  usedPaths.add(candidate);
  return candidate;
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

  // 画像本体は、実績のある方式（arraybufferで並列取得）のまま取得する。
  // ストリーム取得（responseType:"stream"）に切り替えたところ、本番環境で
  // 1ファイルの取得に20〜30秒以上かかる異常な遅さが確認されたため撤回した。
  // ZIP出力側もgenerateNodeStream+Readable.toWebでストリーミングを試したが、
  // ローカルでは正常なZIPが生成できる一方、本番環境でダウンロードしたZIPが
  // 壊れる事象が発生したため撤回。ストリーミングレスポンス自体がこの環境と
  // 相性が悪い可能性があるため、出力も含めて実績のある一括生成方式に戻す。
  // メモリ対策は「並列数を下げる」「圧縮しない（STORE）」のみで行う。
  const zip = new JSZip();
  const usedPaths = new Set<string>();
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

      const rawPath = file.folderLabel ? `${file.folderLabel}/${baseName}` : baseName;
      const path = dedupePath(rawPath, usedPaths);
      zip.file(path, data, { compression: "STORE" });
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
