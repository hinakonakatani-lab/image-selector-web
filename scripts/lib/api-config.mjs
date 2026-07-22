import { execFileSync } from "node:child_process";

const KEYCHAIN_SERVICE = "image-selector-labels-token";

export function getBaseUrl(env = process.env) {
  const base = env.LABELS_API_BASE;
  if (!base) throw new Error("LABELS_API_BASE（アプリのURL）が未設定です");
  if (!/^https?:\/\//.test(base)) throw new Error("LABELS_API_BASE は http(s) URL である必要があります");
  return base;
}

// キーチェーンから専用トークンを取得。値はログしない。
export function getToken() {
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
    });
    return out.replace(/\n$/, "");
  } catch {
    throw new Error(
      `キーチェーンに ${KEYCHAIN_SERVICE} が見つかりません。セットアップ手順（scripts/README.md）を実行してください`
    );
  }
}
