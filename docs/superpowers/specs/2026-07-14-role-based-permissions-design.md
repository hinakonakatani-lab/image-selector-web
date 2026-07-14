# ロールベース権限システム 設計書

日付: 2026-07-14

## 背景・目的

現状、認証はNextAuth（Google OAuth）のみで、ログインできれば誰でも全機能を使える。唯一の権限チェックは「全データBK(管理者用)」機能で、管理者メールアドレスが`app/page.tsx`と`app/api/admin-backup/route.ts`の2箇所にハードコードされている。

以下3段階のロールを導入する。

1. **管理者** — 全機能使用可能（現状の`hinako.nakatani@shintairiku.jp`が該当）
2. **一般ユーザー** — 「全データBK(管理者用)」のみ使用不可（非表示）。それ以外は現状通り全機能使用可能
3. **制限付与ユーザー** — 指定のメールアドレスでログインしたユーザー。「インポート（復元）」機能と「色タブ」機能が使用不可（非表示）。加えて管理者専用機能も当然使用不可

管理者・制限付与ユーザーのメールアドレス一覧は、リポジトリにコミットされる設定ファイルに集約し、ユーザー（中谷さん）が手動でファイルを見れば常に最新の登録状況を確認できるようにする。

## アーキテクチャ

新規ファイル `config/permissions.ts` を1つ追加し、以下を集約する。

```ts
// 権限設定ファイル。
// 管理者・制限付与ユーザーのメールアドレスはここに追加してください。
// （このファイルを見れば現在登録されている対象者が常に分かります）

export const ADMIN_EMAILS: string[] = [
  "hinako.nakatani@shintairiku.jp",
];

export const RESTRICTED_EMAILS: string[] = [
  // 例: "someone@example.com",
];

export type Role = "admin" | "general" | "restricted";

export function getRole(email?: string | null): Role {
  const normalized = (email || "").toLowerCase();
  if (ADMIN_EMAILS.some((e) => e.toLowerCase() === normalized)) return "admin";
  if (RESTRICTED_EMAILS.some((e) => e.toLowerCase() === normalized)) return "restricted";
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
```

DBや新しいユーザーテーブルは追加しない。ロールは各リクエストのたびにセッションのメールアドレスから都度算出する（永続化しない）。

## 変更対象コンポーネント

### `app/page.tsx`
- 92行目のハードコード比較を削除し、`const role = getRole(session?.user?.email)` に置き換える
- `isAdmin`（`role === "admin"`）は既存通り`ExportImport`に渡す
- 新規に`canImport(role)`の結果を`ExportImport`へ`canImport` propとして渡す
- `canUseColorFeatures(role)`がfalseの場合、`ManualColorPicker`をレンダリングしない（207行目）
- `ImageGrid`に新規`canUseColor`propとして`canUseColorFeatures(role)`を渡す

### `app/components/ExportImport.tsx`
- Propsに`canImport?: boolean`を追加
- `canImport`がfalseのとき、「📂 復元」ボタンとその`<input type="file">`（93-105行目）を非表示にする
- 「💾 このフォルダをバックアップ」（84-92行目）は制限付与ユーザーでも表示したまま変更しない
- 「📦 全データBK(管理者用)」は既存の`isAdmin`ガードのまま変更なし

### `app/components/ImageGrid.tsx`
- Propsに`canUseColor?: boolean`を追加
- `canUseColor`がfalseのとき、以下をすべて非表示にする（いずれも色データの閲覧・割り当てに関わるため）
  - `COLOR_TABS.map(...)`による色カテゴリタブ（855-871行目）
  - 「📥 インポート」ボタン（872-877行目）とそのパネル（964-991行目）— これは`ExportImport.tsx`の「📂 復元」とは別物で、スプレッドシートの色データをファイルID+カラーコードの形式で貼り付けて`/api/colors`（PUT）に流し込む機能。文言が「インポート」そのものであり、かつ色データの一括書き込みでもあるため、色タブと同様に制限対象とする
  - 左サイドバーの色選択ボタン群（`COLOR_TABS.map`、1261-1280行目）と「⬜ 色を消す」ボタン（1281-1289行目）
- 「全て」「ランダム」タブ（832-854行目）は色機能ではないため、制限付与ユーザーにも表示したままにする
- `ManualColorPicker`は別コンポーネント（page.tsx側で非表示制御）

### バックエンドAPI（UI非表示に加えて必ず併用する）

- **`app/api/admin-backup/route.ts`**: 28-30行目のハードコード比較を`getRole(session.user.email) !== "admin"`による403判定に置換
- **`app/api/import/route.ts`**: 13-17行目の未ログインチェックの直後に、`getRole(email) === "restricted"`なら403 `{ error: "権限がありません" }`を返す処理を追加
- **`app/api/colors/route.ts`**（GET/POST/PUT）: 各ハンドラの未ログインチェック直後に、`getRole(session.user.email) === "restricted"`なら403を返す処理を追加
- **`app/api/manual-color/route.ts`**: 同様に、未ログインチェック直後に制限付与ユーザーを403で拒否する処理を追加

## データフロー

```
ログイン(Google OAuth)
  → session.user.email 取得
  → app/page.tsx で getRole(email) を1回算出
  → role から isAdmin / canImport / canUseColor を導出し、各クライアントコンポーネントへpropsとして配布
  → 各APIルートは、リクエストのたびに個別に auth() → getRole() を呼び出し、許可/拒否を判定
```

ロール情報はRedis等に保存せず、常にリクエスト時点の`RESTRICTED_EMAILS`/`ADMIN_EMAILS`の内容から判定する。設定ファイルを編集してデプロイすれば即座に反映される。

## エラーハンドリング

- API側で権限がない場合は、既存の401パターン（未ログイン）に倣い、403 `{ error: "権限がありません" }` を返す
- UI側は対象のボタン・タブを完全に非表示にするため、通常の操作フローでは制限付与ユーザーがエラー画面を見ることはない（直接API URLを叩いた場合のみ403が返る）

## テスト方針

自動テストの仕組みが現状リポジトリに存在しないため、実装後に以下を手動で確認する。

1. 管理者アカウントでログイン → 全ボタン・全タブが表示され、全データBKも実行できる
2. 一般ユーザーアカウント（どちらのリストにも属さないアカウント）でログイン → 全データBKボタンのみ非表示、インポート・色タブは利用可能
3. `RESTRICTED_EMAILS`に追加したテスト用アカウントでログイン → 「📂 復元」ボタンと色カテゴリタブが非表示になっており、`/api/import`・`/api/colors`・`/api/manual-color`を直接叩くと403が返る

## スコープ外

- ユーザー管理DB・管理画面UIの新設（今回はコミット済み設定ファイルによる管理のみ）
- ロールの階層化・カスタムロール追加機能（今回は3段階固定）
- 監査ログ・操作履歴の記録
