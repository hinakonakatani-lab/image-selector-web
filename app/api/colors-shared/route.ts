import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const SCAN_MATCH = "colors:shared:*";
const PREFIX = "colors:shared:";

// 定数時間比較。長さ不一致は先に false。
function tokenOk(header: string | null): boolean {
  const expected = process.env.LABELS_INGEST_TOKEN;
  if (!expected) return false; // サーバー未設定
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authError(): NextResponse | null {
  if (!process.env.LABELS_INGEST_TOKEN) {
    return NextResponse.json({ error: "サーバー未設定（LABELS_INGEST_TOKEN）" }, { status: 503 });
  }
  return null;
}

// 読み取り専用（GETのみ）。colors:shared:* の書き込みは /api/colors（NextAuthセッション）経由に限定する。
export async function GET(request: Request) {
  const misconfig = authError();
  if (misconfig) return misconfig;
  if (!tokenOk(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items: { folderId: string; fileId: string; color: string }[] = [];
  let cursor: string | number = 0;
  do {
    const result: [string | number, string[]] = await kv.scan(cursor, { match: SCAN_MATCH, count: 100 });
    const [next, keys] = result;
    cursor = next;
    for (const key of keys) {
      const folderId = key.slice(PREFIX.length);
      const map = (await kv.get<Record<string, string>>(key)) || {};
      for (const [fileId, color] of Object.entries(map)) items.push({ folderId, fileId, color });
    }
  } while (cursor !== 0 && cursor !== "0");

  return NextResponse.json({ items });
}
