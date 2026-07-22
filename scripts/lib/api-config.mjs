import { execFileSync } from "node:child_process";

const KEYCHAIN_SERVICE = "image-selector-labels-token";
const GOOGLE_KEYCHAIN_SERVICE = "image-selector-google-oauth";

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

// Google OAuth 認証情報（JSON 文字列）をパースし検証する（純関数）。
export function parseGoogleCreds(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("Google認証情報のJSONが不正です");
  }
  const { clientId, clientSecret, refreshToken } = obj;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google認証情報には clientId / clientSecret / refreshToken が必要です");
  }
  return { clientId, clientSecret, refreshToken };
}

// キーチェーンから Google OAuth（drive.readonly）認証情報を取得。値はログしない。
export function getGoogleCreds() {
  let raw;
  try {
    raw = execFileSync("security", ["find-generic-password", "-s", GOOGLE_KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
    }).replace(/\n$/, "");
  } catch {
    throw new Error(
      `キーチェーンに ${GOOGLE_KEYCHAIN_SERVICE} が見つかりません。セットアップ手順（scripts/README.md）を実行してください`
    );
  }
  return parseGoogleCreds(raw);
}
