import { auth } from "@/auth";
import { google } from "googleapis";
import { NextResponse } from "next/server";
import { refreshThumbnails } from "@/lib/thumbnail-refresh";

// 画面に表示できなかったサムネイルの fileId を受け取り、今有効なURLを返す。
// Drive の thumbnailLink は1時間未満で失効するため、開きっぱなしのタブでは
// 遅延読み込みされる画像だけが 403 になる。失敗した画像だけ取り直す。
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  let body: { fileIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }

  const { fileIds } = body;
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json({ error: "fileIds が必要です" }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  const urls = await refreshThumbnails(drive, fileIds);
  return NextResponse.json({ urls });
}
