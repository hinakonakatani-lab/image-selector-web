import { auth } from "@/auth";
import { google } from "googleapis";
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
  if (!session?.accessToken) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { fileUrl, color } = await request.json();

  const fileId = extractFileId(fileUrl);
  if (!fileId) {
    return NextResponse.json({ error: "URLからファイルIDを取得できませんでした" }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  let fileRes;
  try {
    fileRes = await drive.files.get({
      fileId,
      fields: "id, name, parents",
      supportsAllDrives: true,
    });
  } catch {
    return NextResponse.json({ error: "ファイルが見つかりません（アクセス権限がない可能性があります）" }, { status: 404 });
  }

  const parentId = fileRes.data.parents?.[0];
  if (!parentId) {
    return NextResponse.json({ error: "親フォルダIDを取得できませんでした" }, { status: 400 });
  }

  const colorKey = `colors:shared:${parentId}`;
  const existingColors = (await kv.get<Record<string, string>>(colorKey)) || {};

  if (color) {
    existingColors[fileId] = color;
  } else {
    delete existingColors[fileId];
  }

  await kv.set(colorKey, existingColors);

  return NextResponse.json({
    ok: true,
    fileId,
    fileName: fileRes.data.name,
    folderId: parentId,
    color,
  });
}
