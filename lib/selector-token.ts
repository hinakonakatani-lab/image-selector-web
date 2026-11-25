import { timingSafeEqual } from "node:crypto";

// メンバー用の読み取り専用トークン(SELECTOR_TOKEN)の照合。定数時間比較。
// 書き込み権限を持つ LABELS_INGEST_TOKEN とは別物。サーバー側が未設定・空なら常に false。
export function selectorTokenOk(header: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  if (!header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice("Bearer ".length));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
