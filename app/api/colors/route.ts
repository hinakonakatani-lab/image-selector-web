import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// 色データのキー形式: colors:{userId}:{folderId}
// 値: { fileId: colorCode } のJSON

function getKey(_userId: string, folderId: string) {
  return `colors:shared:${folderId}`;
}

// 色データを取得
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

  const key = getKey(session.user.email, folderId);
  const colors = (await kv.get<Record<string, string>>(key)) || {};
  return NextResponse.json({ colors });
}

// 色データを保存（複数枚まとめて1リクエストで）
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, fileId, fileIds, color } = await request.json();
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  // fileIds（複数）またはfileId（単体）に対応
  const ids: string[] = fileIds ?? (fileId ? [fileId] : []);
  if (ids.length === 0) {
    return NextResponse.json({ error: "fileIdが必要です" }, { status: 400 });
  }

  const key = getKey(session.user.email, folderId);
  const colors = (await kv.get<Record<string, string>>(key)) || {};

  for (const id of ids) {
    if (color === null) {
      delete colors[id];
    } else {
      colors[id] = color;
    }
  }

  await kv.set(key, colors);
  return NextResponse.json({ ok: true });
}

// 色データを一括インポート（スプレッドシートからのデータ）
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, importColors } = await request.json();
  if (!folderId || !importColors) {
    return NextResponse.json({ error: "folderId・importColorsが必要です" }, { status: 400 });
  }

  const key = getKey(session.user.email, folderId);
  const existing = (await kv.get<Record<string, string>>(key)) || {};
  const merged = { ...existing, ...importColors };

  await kv.set(key, merged);
  return NextResponse.json({ ok: true, count: Object.keys(importColors).length });
}
