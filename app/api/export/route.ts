import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

type Bookmark = { id: string; name: string; folderId: string };

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const email = session.user.email;
  const bookmarks = (await kv.get<Bookmark[]>(`bookmarks:${email}`)) || [];

  // 各フォルダの色・月データを収集
  const folders: Record<string, { name: string; colors: Record<string, string>; months: Record<string, string> }> = {};

  for (const b of bookmarks) {
    const colors = (await kv.get<Record<string, string>>(`colors:shared:${b.folderId}`)) || {};
    const months = (await kv.get<Record<string, string>>(`months:shared:${b.folderId}`)) || {};
    folders[b.folderId] = { name: b.name, colors, months };
  }

  const data = {
    exportedAt: new Date().toISOString(),
    version: 1,
    bookmarks,
    folders,
  };

  return NextResponse.json(data);
}
