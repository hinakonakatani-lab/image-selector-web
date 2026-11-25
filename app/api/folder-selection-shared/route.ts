import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import { selectorTokenOk } from "@/lib/selector-token";
import { selectionPayload } from "@/lib/folder-selection";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// チャチャマル(インスタ投稿生成)向けの読み取り専用API。
// 「何本目にどの画像が選ばれているか」を、ログインなし・SELECTOR_TOKEN(Bearer)で返す。
// 返すのは folderTags と renameMap だけ(画像の実体はドライブにあり、ここでは配らない)。
// GETのみ。書き込みは /api/folder-tags(セッション必須)経由に限る。

export async function GET(request: Request) {
  if (!process.env.SELECTOR_TOKEN) {
    return NextResponse.json({ error: "サーバー未設定（SELECTOR_TOKEN）" }, { status: 503 });
  }
  if (!selectorTokenOk(request.headers.get("authorization"), process.env.SELECTOR_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const folderId = new URL(request.url).searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  const [folderTags, renameMap] = await Promise.all([
    kv.get<Record<string, number>>(`folderTags:shared:${folderId}`),
    kv.get<Record<string, string>>(`renameMap:shared:${folderId}`),
  ]);

  return NextResponse.json(selectionPayload(folderId, folderTags, renameMap));
}
