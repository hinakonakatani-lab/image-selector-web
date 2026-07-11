import { auth } from "@/auth";
import { google } from "googleapis";
import JSZip from "jszip";
import { Readable } from "node:stream";

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

// TEMPORARY diagnostic logging to find where a reported multi-minute hang
// occurs. Remove once the hang's location is identified and fixed.
function diag(label: string, extra?: unknown) {
  console.log(`[download-zip][diag] +${Date.now() - diagStart}ms ${label}`, extra ?? "");
}
let diagStart = 0;

export async function POST(request: Request) {
  diagStart = Date.now();
  diag("request start");

  const session = await auth();
  if (!session?.accessToken) {
    return new Response(JSON.stringify({ error: "未ログイン" }), { status: 401 });
  }
  diag("auth ok");

  const { files } = (await request.json()) as { files: ZipFileRequest[] };
  if (!files || files.length === 0) {
    return new Response(JSON.stringify({ error: "filesが必要です" }), { status: 400 });
  }
  diag("parsed body", { fileCount: files.length });

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  // 1段階目: メタデータ（ファイル名）だけを先に取得してアクセス可否を確認する。
  // 画像本体はまだ取得しない — メモリに全画像を同時に保持するとVercel関数の
  // メモリ上限を超えてOOMになるため（実際に大きめの写真セットで発生した障害）、
  // 本体の取得はZIP生成時にストリームとして少しずつ行う。
  const usedPaths = new Set<string>();
  let failedCount = 0;
  const validFiles: { fileId: string; path: string }[] = [];

  diag("metadata phase: start");
  await mapWithConcurrency(files, CONCURRENCY, async (file) => {
    diag("metadata: fetching", file.fileId);
    try {
      const meta = await drive.files.get({
        fileId: file.fileId,
        fields: "name",
        supportsAllDrives: true,
      });
      diag("metadata: got", file.fileId);
      const originalName = meta.data.name || file.fileId;
      const dotIndex = originalName.lastIndexOf(".");
      const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : "";
      const baseName = file.name ? `${file.name}${ext}` : originalName;

      const rawPath = file.folderLabel ? `${file.folderLabel}/${baseName}` : baseName;
      const path = dedupePath(rawPath, usedPaths);
      validFiles.push({ fileId: file.fileId, path });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[download-zip] metadata failed:", file.fileId, message);
      diag("metadata: FAILED", { fileId: file.fileId, message });
      failedCount++;
    }
  });
  diag("metadata phase: done", { validCount: validFiles.length, failedCount });

  if (validFiles.length === 0) {
    return new Response(JSON.stringify({ error: "全てのファイルの取得に失敗しました" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2段階目: 各ファイルの本体をストリームのままZIPに登録する。実際のダウンロードは
  // generateNodeStream()が読み出す際に少しずつ行われるため、全ファイルの生データを
  // 同時にメモリへ保持することがない。画像は既に圧縮済みの形式（JPEG等）なので
  // 再圧縮のメリットが薄く、圧縮処理自体のメモリ・CPU負荷を避けるためSTOREを使う。
  const zip = new JSZip();
  let zippedCount = 0;
  for (const { fileId, path } of validFiles) {
    diag("media: opening stream", fileId);
    try {
      const res = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" }
      );
      diag("media: stream opened", fileId);
      zip.file(path, res.data as unknown as NodeJS.ReadableStream, { compression: "STORE" });
      diag("media: registered in zip", fileId);
      zippedCount++;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[download-zip] media fetch failed:", fileId, message);
      diag("media: FAILED", { fileId, message });
      failedCount++;
    }
  }
  diag("media phase: done", { zippedCount, failedCount });

  if (zippedCount === 0) {
    return new Response(JSON.stringify({ error: "全てのファイルの取得に失敗しました" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  diag("generating zip stream");
  const nodeStream = zip.generateNodeStream({ type: "nodebuffer", streamFiles: true });
  nodeStream.on("end", () => diag("zip nodeStream: end event"));
  nodeStream.on("error", (err) => diag("zip nodeStream: ERROR", String(err)));
  const webStream = Readable.toWeb(nodeStream as Readable) as ReadableStream;
  diag("returning response");

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="images.zip"`,
      "X-Failed-Count": String(failedCount),
    },
  });
}
