import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// Redisのキーを全件スキャンしてパターンに一致するものを取得
async function scanAllKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | number = 0;
  do {
    const result: [string | number, string[]] = await kv.scan(cursor, { match: pattern, count: 100 });
    const [nextCursor, batch] = result;
    keys.push(...batch);
    cursor = nextCursor;
  } while (cursor !== 0 && cursor !== "0");
  return keys;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (session.user.email.toLowerCase() !== "hinako.nakatani@shintairiku.jp") {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  // colors:shared:* と months:shared:* の全キーをスキャン
  const [colorKeys, monthKeys] = await Promise.all([
    scanAllKeys("colors:shared:*"),
    scanAllKeys("months:shared:*"),
  ]);

  // 全フォルダIDを収集
  const folderIds = new Set<string>();
  for (const key of colorKeys) {
    const folderId = key.replace("colors:shared:", "");
    folderIds.add(folderId);
  }
  for (const key of monthKeys) {
    const folderId = key.replace("months:shared:", "");
    folderIds.add(folderId);
  }

  // 各フォルダの色・月データを取得
  const folders: Record<string, { colors: Record<string, string>; months: Record<string, string> }> = {};

  await Promise.all(
    Array.from(folderIds).map(async (folderId) => {
      const [colors, months] = await Promise.all([
        kv.get<Record<string, string>>(`colors:shared:${folderId}`),
        kv.get<Record<string, string>>(`months:shared:${folderId}`),
      ]);
      folders[folderId] = {
        colors: colors || {},
        months: months || {},
      };
    })
  );

  const data = {
    exportedAt: new Date().toISOString(),
    version: 1,
    exportedBy: session.user.email,
    totalFolders: folderIds.size,
    folders,
  };

  return NextResponse.json(data);
}
