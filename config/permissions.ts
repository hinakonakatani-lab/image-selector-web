// 権限設定ファイル
//
// 管理者・制限付与ユーザーのメールアドレスはここに追加してください。
// このファイルを見れば、現在誰が管理者/制限付与ユーザーとして
// 登録されているかが常に分かります。
//
// ①管理者: 全機能を使用できます
// ②一般ユーザー（下記どちらのリストにも含まれないユーザー）:
//    「全データBK(管理者用)」以外の全機能を使用できます
// ③制限付与ユーザー: 「インポート」「色タブ」「メモ」「本数モード」関連の機能が使用できません

export const ADMIN_EMAILS: string[] = [
  "hinako.nakatani@shintairiku.jp",
];

export const RESTRICTED_EMAILS: string[] = [
  "h.nakatani04@gmail.com",
];

export type Role = "admin" | "general" | "restricted";

function includesEmail(list: string[], email: string): boolean {
  return list.some((e) => e.toLowerCase() === email);
}

export function getRole(email?: string | null): Role {
  const normalized = (email || "").toLowerCase();
  if (!normalized) return "restricted";
  if (includesEmail(ADMIN_EMAILS, normalized)) return "admin";
  if (includesEmail(RESTRICTED_EMAILS, normalized)) return "restricted";
  return "general";
}

export function canAccessAdminBackup(role: Role): boolean {
  return role === "admin";
}

export function canImport(role: Role): boolean {
  return role !== "restricted";
}

export function canUseColorFeatures(role: Role): boolean {
  return role !== "restricted";
}

export function canEditMemos(role: Role): boolean {
  return role !== "restricted";
}

export function canUseFolderTagFeature(role: Role): boolean {
  return role !== "restricted";
}
