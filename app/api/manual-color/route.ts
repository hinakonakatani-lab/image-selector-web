import { auth } from "@/auth";
import { getRole, canUseColorFeatures } from "@/config/permissions";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// GoogleドライブURLからfileIdを抽出
function extractFileId(url: string): string | null {
  // https://drive.google.com/file/d/FILE_ID/view
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  // https://drive.google.com/open?id=FILE_ID
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  // IDのみ（直接貼り付け）
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (!canUseColorFeatures(getRole(session.user.email))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const { fileUrl, color, folderId } = await request.json();

  if (!folderId) {
    return NextResponse.json({ error: "フォルダIDが指定されていません" }, { status: 400 });
  }

  const fileId = extractFileId(fileUrl);
  if (!fileId) {
    return NextResponse.json({ error: "URLからファイルIDを取得できませんでした" }, { status: 400 });
  }

  const colorKey = `colors:shared:${folderId}`;
  const existingColors = (await kv.get<Record<string, string>>(colorKey)) || {};

  if (color) {
    existingColors[fileId] = color;
  } else {
    delete existingColors[fileId];
  }

  await kv.set(colorKey, existingColors);

  return NextResponse.json({ ok: true, fileId, color });
}
