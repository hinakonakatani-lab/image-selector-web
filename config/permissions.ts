// 権限設定ファイル
//
// 管理者・一般ユーザーのメールアドレスはここに追加してください。
// このファイルを見れば、現在誰が管理者/一般ユーザーとして
// 登録されているかが常に分かります。
//
// ①管理者: 全機能を使用できます
// ②一般ユーザー（下記GENERAL_EMAILSに登録されたユーザー）:
//    「全データBK(管理者用)」以外の全機能を使用できます
// ③制限付与ユーザー（上記どちらのリストにも含まれない、未登録の全ユーザー）:
//    「インポート」「色タブ」「メモ」「本数モード」関連の機能が使用できません

export const ADMIN_EMAILS: string[] = [
  "hinako.nakatani@shintairiku.jp",
];

export const GENERAL_EMAILS: string[] = [
  "atsuyoshi_suzuki@shintairiku.jp",
  "kanae.suzuki@shintairiku.jp",
  "takato.kojima@shintairiku.jp",
  "yuichirou.kosaku@shintairiku.jp",
  "yuya.kino@shintairiku.jp",
  "mika.hasegawa@shintairiku.jp",
  "rie.ikoma@shintairiku.jp",
  "izumi.nakamura@shintairiku.jp",
  "yukako.fukushima@shintairiku.jp",
  "yoshino.yamamoto@shintairiku.jp",
  "marketing.shintairiku@gmail.com",
  "toru.kimura@shintairiku.jp",
  "fumiko.oda@shintairiku.jp",
  "takeshi.ogura@shintairiku.jp",
  "tsukasa.ono@shintairiku.jp",
  "mariko.igarashi@shintairiku.jp",
  "sayaka.suzuki@shintairiku.jp",
  "youka.fujihara@shintairiku.jp",
  "mami.moriguchi@shintairiku.jp",
  "risa.araki@shintairiku.jp",
  "takumi.fujiwara@shintairiku.jp",
  "erika.bessho@shintairiku.jp",
  "hiromi.teruya@shintairiku.jp",
  "kuniko.nakaya@shintairiku.jp",
  "natsumi.abe@shintairiku.jp",
  "mari.nobuhiro@shintairiku.jp",
  "rie.hirase@shintairiku.jp",
  "misaki.fujikawa@shintairiku.jp",
  "rin.okubo@shintairiku.jp",
  "saki.kaneko@shintairiku.jp",
  "kazuma.miyazaki@shintairiku.jp",
  "ami.yushita@shintairiku.jp",
  "harumi.ishibashi@shintairiku.jp",
  "risa.chiba@shintairiku.jp",
  "koichiro.hirata@shintairiku.jp",
  "wakana.naruse@shintairiku.jp",
  "daiki.nishimatsu@shintairiku.jp",
  "nanako.morita@shintairiku.jp",
  "koki.nagase@shintairiku.jp",
  "asuka.toriyama@shintairiku.jp",
  "yuki.ominato@shintairiku.jp",
  "yuto.sakuma@shintairiku.jp",
  "toru.takagi@shintairiku.jp",
  "naoto.shimozawa@shintairiku.jp",
  "satoshi.kounushi@shintairiku.jp",
  "akira.sakata@shintairiku.jp",
  "maki.shigemori@shintairiku.jp",
  "tsukasa.matsunaga@shintairiku.jp",
  "yusuke.tokunaga@shintairiku.jp",
  "h.nakatani04@gmail.com",
  "yukihon.pen@gmail.com",
];

export type Role = "admin" | "general" | "restricted";

function includesEmail(list: string[], email: string): boolean {
  return list.some((e) => e.toLowerCase() === email);
}

export function getRole(email?: string | null): Role {
  const normalized = (email || "").toLowerCase();
  if (!normalized) return "restricted";
  if (includesEmail(ADMIN_EMAILS, normalized)) return "admin";
  if (includesEmail(GENERAL_EMAILS, normalized)) return "general";
  return "restricted";
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
