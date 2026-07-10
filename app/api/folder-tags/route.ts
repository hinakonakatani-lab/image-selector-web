import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// 本目タグのキー形式: folderTags:shared:{folderId}
// 値: { fileId: 本目番号(number) } のJSON

function getKey(folderId: string) {
  return `folderTags:shared:${folderId}`;
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

  const folderTags = (await kv.get<Record<string, number>>(getKey(folderId))) || {};
  return NextResponse.json({ folderTags });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, fileId, fileIds, tag } = await request.json();
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  const ids: string[] = fileIds ?? (fileId ? [fileId] : []);
  if (ids.length === 0) {
    return NextResponse.json({ error: "fileIdが必要です" }, { status: 400 });
  }

  const key = getKey(folderId);
  const folderTags = (await kv.get<Record<string, number>>(key)) || {};

  for (const id of ids) {
    if (tag === null) {
      delete folderTags[id];
    } else {
      folderTags[id] = tag;
    }
  }

  await kv.set(key, folderTags);
  return NextResponse.json({ ok: true });
}
