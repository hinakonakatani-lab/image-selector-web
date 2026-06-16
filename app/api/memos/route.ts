import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export type MemoEntry = { text: string; authorName: string; updatedAt: string };

function getKey(folderId: string) {
  return `memos:shared:${folderId}`;
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
  const memos = (await kv.get<Record<string, MemoEntry>>(getKey(folderId))) || {};
  return NextResponse.json({ memos });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, fileId, fileIds, text } = await request.json();
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  const ids: string[] = fileIds ?? (fileId ? [fileId] : []);
  if (ids.length === 0) {
    return NextResponse.json({ error: "fileIdが必要です" }, { status: 400 });
  }

  const key = getKey(folderId);
  const memos = (await kv.get<Record<string, MemoEntry>>(key)) || {};

  for (const id of ids) {
    if (text === null) {
      delete memos[id];
    } else {
      memos[id] = {
        text,
        authorName: session.user.name || session.user.email,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  await kv.set(key, memos);
  return NextResponse.json({ ok: true });
}
