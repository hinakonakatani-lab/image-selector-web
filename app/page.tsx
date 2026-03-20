import { auth, signIn, signOut } from "@/auth";
import { google } from "googleapis";
import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});
import ImageGrid from "@/app/components/ImageGrid";
import type { DriveFolder } from "@/app/api/drive/route";

type FolderCache = {
  folders: DriveFolder[];
  cachedAt: number;
};

async function getFoldersRecursive(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  parentPath: string
): Promise<DriveFolder[]> {
  const nameRes = await drive.files.get({ fileId: folderId, fields: "name", supportsAllDrives: true });
  const name = nameRes.data.name || folderId;
  const currentPath = parentPath ? `${parentPath} / ${name}` : name;

  const imagesRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and not mimeType = 'image/vnd.adobe.photoshop' and trashed = false`,
    fields: "files(id, name, thumbnailLink, webViewLink)",
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const images = (imagesRes.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
    thumbnailUrl: f.thumbnailLink?.replace("=s220", "=s300") || "",
    webViewLink: f.webViewLink!,
  }));

  const result: DriveFolder[] = [];
  if (images.length > 0) {
    result.push({ id: folderId, name, path: currentPath, images });
  }

  const subRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  for (const sub of subRes.data.files || []) {
    const subFolders = await getFoldersRecursive(drive, sub.id!, currentPath);
    result.push(...subFolders);
  }

  return result;
}

function formatCachedAt(cachedAt: number): string {
  const diffMs = Date.now() - cachedAt;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay > 0) return `${diffDay}日前`;
  if (diffHour > 0) return `${diffHour}時間前`;
  if (diffMin > 0) return `${diffMin}分前`;
  return "たった今";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ folderId?: string; refresh?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const folderId = params.folderId || "";
  const forceRefresh = params.refresh === "1";

  // 未ログイン or トークン更新失敗 → ログイン画面
  if (!session || session.error === "RefreshAccessTokenError") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow text-center">
          <h1 className="text-2xl font-bold mb-2">🖼️ 画像選定ツール</h1>
          <p className="text-gray-500 mb-6">Googleアカウントでログインしてください</p>
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <button
              type="submit"
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg font-medium"
            >
              Googleでログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 画像・色データ取得
  let folders: DriveFolder[] = [];
  let colors: Record<string, string> = {};
  let months: Record<string, string> = {};
  let cachedAt: number | null = null;
  let error = "";

  if (folderId && session.accessToken) {
    try {
      const cacheKey = `cache:${session.user?.email}:${folderId}`;
      let fromCache = false;

      // キャッシュ確認（強制更新でなければ使用）
      if (!forceRefresh) {
        const cached = await kv.get<FolderCache>(cacheKey);
        if (cached?.folders?.length) {
          folders = cached.folders;
          cachedAt = cached.cachedAt;
          fromCache = true;
        }
      }

      // キャッシュなし or 強制更新 → Google Driveから取得してキャッシュ保存
      if (!fromCache) {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth: oauth2Client });

        folders = await getFoldersRecursive(drive, folderId, "");
        const now = Date.now();
        if (folders.length > 0) {
          await kv.set(cacheKey, { folders, cachedAt: now });
          cachedAt = now;
        }
      }

      const colorKey = `colors:${session.user?.email}:${folderId}`;
      colors = (await kv.get<Record<string, string>>(colorKey)) || {};

      const monthKey = `months:${session.user?.email}:${folderId}`;
      months = (await kv.get<Record<string, string>>(monthKey)) || {};
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : "エラーが発生しました";
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <h1 className="text-lg font-bold">🖼️ 画像選定ツール</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{session.user?.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button type="submit" className="text-sm text-gray-400 hover:text-gray-600">
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 py-6">
        {/* フォルダID入力フォーム */}
        <form method="get" className="mb-4 flex gap-2">
          <input
            name="folderId"
            defaultValue={folderId}
            placeholder="GoogleドライブのフォルダIDを入力（URLの末尾のランダムな文字列）"
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            type="submit"
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
          >
            読み込む
          </button>
        </form>

        {/* キャッシュ情報 + 再読み込みボタン */}
        {folderId && cachedAt && (
          <div className="mb-4 flex items-center gap-2 text-xs text-gray-400">
            <span>📦 キャッシュ表示中（最終更新: {formatCachedAt(cachedAt)}）</span>
            <form method="get">
              <input type="hidden" name="folderId" value={folderId} />
              <input type="hidden" name="refresh" value="1" />
              <button
                type="submit"
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 hover:border-gray-400 hover:text-gray-600 transition-colors"
              >
                🔄 再読み込み
              </button>
            </form>
          </div>
        )}

        {/* 凡例 */}
        {folderId && (
          <div className="mb-4 flex flex-wrap gap-2 items-center">
            <span className="text-xs text-gray-500 font-medium">色の意味：</span>
            {[
              { color: "#ea9999", label: "🟥 赤" },
              { color: "#b6d7a8", label: "🟩 緑" },
              { color: "#a4c2f4", label: "🟦 青" },
              { color: "#b4a7d6", label: "🟪 紫" },
              { color: "#ffe599", label: "🟨 黄（候補）" },
              { color: "#999999", label: "⬛ グレー（NG）" },
            ].map((c) => (
              <span
                key={c.color}
                className="px-2 py-0.5 rounded text-xs text-gray-700"
                style={{ backgroundColor: c.color }}
              >
                {c.label}
              </span>
            ))}
          </div>
        )}

        {/* エラー表示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded mb-4 text-sm">
            エラー: {error}
          </div>
        )}

        {/* フォルダ未入力の案内 */}
        {!folderId && (
          <div className="text-center text-gray-400 py-20">
            <p className="text-5xl mb-4">📁</p>
            <p className="text-lg">GoogleドライブのフォルダIDを入力して「読み込む」を押してください</p>
            <p className="text-sm mt-2">
              フォルダIDはGoogleドライブでフォルダを開いた時のURLの末尾部分です
            </p>
            <code className="block mt-2 text-xs bg-gray-100 px-3 py-1 rounded inline-block">
              https://drive.google.com/drive/folders/<span className="text-blue-500 font-bold">ここがフォルダID</span>
            </code>
          </div>
        )}

        {/* 画像グリッド */}
        {folders.length > 0 && (
          <ImageGrid folders={folders} folderId={folderId} initialColors={colors} initialMonths={months} />
        )}

        {/* 画像なし */}
        {folderId && folders.length === 0 && !error && (
          <div className="text-center text-gray-400 py-20">
            <p>このフォルダに画像が見つかりませんでした</p>
          </div>
        )}
      </main>
    </div>
  );
}
