import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

type Bookmark = { id: string; name: string; folderId: string };

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const email = session.user.email;
  const data = await request.json();

  if (data.version !== 1 || !data.bookmarks || !data.folders) {
    return NextResponse.json({ error: "不正なファイル形式です" }, { status: 400 });
  }

  // ブックマーク復元（既存とマージ）
  const existing = (await kv.get<Bookmark[]>(`bookmarks:${email}`)) || [];
  const existingIds = new Set(existing.map((b: Bookmark) => b.id));
  const newBookmarks = (data.bookmarks as Bookmark[]).filter(b => !existingIds.has(b.id));
  await kv.set(`bookmarks:${email}`, [...existing, ...newBookmarks]);

  // 各フォルダの色・月データ復元
  let restoredFolders = 0;
  for (const [folderId, folderData] of Object.entries(data.folders) as [string, { colors: Record<string, string>; months: Record<string, string> }][]) {
    if (folderData.colors && Object.keys(folderData.colors).length > 0) {
      const existingColors = (await kv.get<Record<string, string>>(`colors:shared:${folderId}`)) || {};
      await kv.set(`colors:shared:${folderId}`, { ...existingColors, ...folderData.colors });
    }
    if (folderData.months && Object.keys(folderData.months).length > 0) {
      const existingMonths = (await kv.get<Record<string, string>>(`months:shared:${folderId}`)) || {};
      await kv.set(`months:shared:${folderId}`, { ...existingMonths, ...folderData.months });
    }
    restoredFolders++;
  }

  return NextResponse.json({
    ok: true,
    restoredFolders,
    restoredBookmarks: newBookmarks.length,
  });
}
