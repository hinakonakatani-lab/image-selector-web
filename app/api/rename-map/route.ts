import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// ダウンロード時のカスタムファイル名（拡張子なし）
// キー形式: renameMap:shared:{folderId}

function getKey(folderId: string) {
  return `renameMap:shared:${folderId}`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  const renameMap = (await kv.get<Record<string, string>>(getKey(folderId))) || {};
  return NextResponse.json({ renameMap });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, fileId, name } = await request.json();
  if (!folderId || !fileId) {
    return NextResponse.json({ error: "folderId・fileIdが必要です" }, { status: 400 });
  }

  const key = getKey(folderId);
  const renameMap = (await kv.get<Record<string, string>>(key)) || {};

  if (!name) {
    delete renameMap[fileId];
  } else {
    renameMap[fileId] = name;
  }

  await kv.set(key, renameMap);
  return NextResponse.json({ ok: true });
}
