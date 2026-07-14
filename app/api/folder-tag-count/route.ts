import { auth } from "@/auth";
import { getRole, canUseFolderTagFeature } from "@/config/permissions";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const DEFAULT_COUNT = 5;

function getKey(folderId: string) {
  return `folderTagCount:${folderId}`;
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

  const count = (await kv.get<number>(getKey(folderId))) ?? DEFAULT_COUNT;
  return NextResponse.json({ count });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (!canUseFolderTagFeature(getRole(session.user.email))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const { folderId, count } = await request.json();
  if (!folderId || typeof count !== "number" || count < 1) {
    return NextResponse.json({ error: "folderId・countが必要です" }, { status: 400 });
  }

  await kv.set(getKey(folderId), count);
  return NextResponse.json({ ok: true });
}
