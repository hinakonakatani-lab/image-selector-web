import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const SCAN_MATCH = "labels:shared:*";
const PREFIX = "labels:shared:";

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

export async function GET(request: Request) {
  const misconfig = authError();
  if (misconfig) return misconfig;
  if (!tokenOk(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items: { folderId: string; fileId: string; label: unknown }[] = [];
  let cursor: string | number = 0;
  do {
    const result: [string | number, string[]] = await kv.scan(cursor, { match: SCAN_MATCH, count: 100 });
    const [next, keys] = result;
    cursor = next;
    for (const key of keys) {
      const folderId = key.slice(PREFIX.length);
      const map = (await kv.get<Record<string, unknown>>(key)) || {};
      for (const [fileId, label] of Object.entries(map)) items.push({ folderId, fileId, label });
    }
  } while (cursor !== 0 && cursor !== "0");

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const misconfig = authError();
  if (misconfig) return misconfig;
  if (!tokenOk(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { folderId, labels } = (await request.json()) as {
    folderId?: string;
    labels?: Record<string, unknown>;
  };
  if (!folderId || !labels || typeof labels !== "object") {
    return NextResponse.json({ error: "folderId・labels が必要です" }, { status: 400 });
  }

  const key = `${PREFIX}${folderId}`;
  const existing = (await kv.get<Record<string, unknown>>(key)) || {};
  const merged = { ...existing, ...labels };
  await kv.set(key, merged);

  return NextResponse.json({ ok: true, count: Object.keys(labels).length });
}
