import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

type Bookmark = { id: string; name: string; folderId: string };

function getKey(email: string) {
  return `bookmarks:${email}`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  const bookmarks = (await kv.get<Bookmark[]>(getKey(session.user.email))) || [];
  return NextResponse.json({ bookmarks });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  const { name, folderId } = await request.json();
  if (!name || !folderId) {
    return NextResponse.json({ error: "name・folderIdが必要です" }, { status: 400 });
  }
  const key = getKey(session.user.email);
  const bookmarks = (await kv.get<Bookmark[]>(key)) || [];
  const newBookmark: Bookmark = { id: Date.now().toString(), name, folderId };
  await kv.set(key, [...bookmarks, newBookmark]);
  return NextResponse.json({ bookmark: newBookmark });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  const { bookmarks } = await request.json();
  await kv.set(getKey(session.user.email), bookmarks);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  const { id } = await request.json();
  const key = getKey(session.user.email);
  const bookmarks = (await kv.get<Bookmark[]>(key)) || [];
  await kv.set(key, bookmarks.filter(b => b.id !== id));
  return NextResponse.json({ ok: true });
}
