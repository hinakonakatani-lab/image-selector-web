import { auth } from "@/auth";
import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";

// 色データのキー形式: colors:{userId}:{folderId}
// 値: { fileId: colorCode } のJSON

function getKey(userId: string, folderId: string) {
  return `colors:${userId}:${folderId}`;
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

// 色データを保存（1枚分）
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, fileId, color } = await request.json();
  if (!folderId || !fileId) {
    return NextResponse.json({ error: "folderId・fileIdが必要です" }, { status: 400 });
  }

  const key = getKey(session.user.email, folderId);
  const colors = (await kv.get<Record<string, string>>(key)) || {};

  if (color === null) {
    delete colors[fileId]; // 色を消す
  } else {
    colors[fileId] = color;
  }

  await kv.set(key, colors);
  return NextResponse.json({ ok: true });
}
