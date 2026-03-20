import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

function getKey(_userId: string, folderId: string) {
  return `months:shared:${folderId}`;
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

  const key = getKey(session.user.email, folderId);
  const months = (await kv.get<Record<string, string>>(key)) || {};
  return NextResponse.json({ months });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, color, month } = await request.json();
  if (!folderId || !color) {
    return NextResponse.json({ error: "folderId・colorが必要です" }, { status: 400 });
  }

  const key = getKey(session.user.email, folderId);
  const months = (await kv.get<Record<string, string>>(key)) || {};

  if (!month) {
    delete months[color];
  } else {
    months[color] = month;
  }

  await kv.set(key, months);
  return NextResponse.json({ ok: true });
}
