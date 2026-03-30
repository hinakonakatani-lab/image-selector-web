import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export type ImageLabel = {
  bigTheme: string;
  specificTheme: string;
  tags: string[];
};

function getKey(email: string, folderId: string) {
  return `labels:${email}:${folderId}`;
}

// ラベル一覧取得
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
  const labels = (await kv.get<Record<string, ImageLabel>>(getKey(session.user.email, folderId))) || {};
  return NextResponse.json({ labels });
}

// ラベルを保存（バッチ）
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  const { folderId, newLabels } = await request.json() as {
    folderId: string;
    newLabels: Record<string, ImageLabel>;
  };
  if (!folderId || !newLabels) {
    return NextResponse.json({ error: "folderId・newLabelsが必要です" }, { status: 400 });
  }
  const key = getKey(session.user.email, folderId);
  const existing = (await kv.get<Record<string, ImageLabel>>(key)) || {};
  await kv.set(key, { ...existing, ...newLabels });
  return NextResponse.json({ ok: true });
}
