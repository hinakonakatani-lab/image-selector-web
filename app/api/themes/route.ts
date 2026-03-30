import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// 確定済みテーマ: { 大テーマ: { 具体テーマ: [imageId, ...] } }
export type ThemeMap = Record<string, Record<string, string[]>>;

function getKey(email: string, folderId: string) {
  return `themes:${email}:${folderId}`;
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
  const themes = (await kv.get<ThemeMap>(getKey(session.user.email, folderId))) || {};
  return NextResponse.json({ themes });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  const { folderId, themes } = await request.json() as { folderId: string; themes: ThemeMap };
  if (!folderId || !themes) {
    return NextResponse.json({ error: "folderId・themesが必要です" }, { status: 400 });
  }
  await kv.set(getKey(session.user.email, folderId), themes);
  return NextResponse.json({ ok: true });
}
