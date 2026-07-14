# ロールベース権限システム 拡張設計書（メモ・本数モード）

日付: 2026-07-14

## 背景・目的

[[2026-07-14-role-based-permissions-design]]（元設計）で導入した3段階ロール（管理者/一般ユーザー/制限付与ユーザー）のうち、制限付与ユーザーの制限対象を拡張する。元設計では「インポート」「色タブ」関連機能のみが制限対象だったが、今回追加で以下2機能も制限付与ユーザーには使用不可（非表示）にする。

1. **メモ機能** — 画像への共有メモの追加・編集・削除
2. **本数モード** — 🔢トグルによる本目タブ・本目番号の割り当て機能

いずれも既存の色機能と同じ方針を踏襲する：**既存データの閲覧は残し、データを変更する操作系だけを隠す**。

- メモ: サムネイル上に表示済みのメモ本文はそのまま見える。追加・編集・削除の導線（サイドバーのボタン、サムネイルのクリックによる編集モーダル起動）を制限付与ユーザーから隠す。
- 本数モード: サムネイル上の本目バッジ（常時表示・既存動作のまま変更なし）はそのまま見える。🔢トグルボタン自体を隠し、本目タブ・割り当てボタンを制限付与ユーザーが有効化できないようにする。

## アーキテクチャ

`config/permissions.ts` に判定関数を2つ追加する。役割は既存の`canImport`/`canUseColorFeatures`と同じパターン（`role !== "restricted"`）。

```ts
export function canEditMemos(role: Role): boolean {
  return role !== "restricted";
}

export function canUseFolderTagFeature(role: Role): boolean {
  return role !== "restricted";
}
```

ファイル冒頭のコメント（10行目「③制限付与ユーザー: ...」）を「インポート」「色タブ」「メモ」「本数モード」の4機能に更新する。

## 変更対象コンポーネント

### `config/permissions.ts`
- `canEditMemos`, `canUseFolderTagFeature` を追加
- 冒頭コメントを更新

### `app/page.tsx`
- `role` から `canEditMemo = canEditMemos(role)`, `canUseFolderTag = canUseFolderTagFeature(role)` を算出
- `<FolderTagVisibilityToggle />`（212行目）を `{canUseFolderTag && <FolderTagVisibilityToggle />}` に変更
- `ImageGrid` 呼び出しに `canEditMemo`・`canUseFolderTag` をpropsとして追加

### `app/components/ImageGrid.tsx`
- Propsに `canEditMemo?: boolean`, `canUseFolderTag?: boolean` を追加（デフォルト`true`、元設計の`canUseColor`と同じ扱い）
- `showFolderTagUI`（`useFolderTagVisibility()`の戻り値）を直接使っている全箇所を `showFolderTagUI && canUseFolderTag` に統一する。対象:
  - 本目タブ行（882行目付近）
  - サイドバーの「n本目」割り当てボタン群（1295行目付近）
  - 「⬜ 本目を消す」ボタン（1304行目付近）
  - これにより、制限付与ユーザーがdevtools等でlocalStorageの`folderTagUIVisible`を直接`true`にしても本目タブ・割り当てボタンは表示されない（バックエンド403と対になる防御）
  - サムネイル上の本目バッジ（732行目付近、`folderTags[image.id]`による常時表示）は対象外・変更なし
- サイドバーのメモ関連ボタンを `canEditMemo` でガード:
  - 「📝 メモ追加/メモ編集」ボタン（1314行目付近）
  - 「📝 メモ削除（N件）」ボタン（1322行目付近）
- サムネイル上のメモ表示（`renderImage`内、786行目付近）:
  - `canEditMemo`がfalseのとき、`onClick={() => openMemoModal(image.id)}` を無効化する（クリックしても編集モーダルを開かない）
  - メモが既にある画像は本文（`📝 {memo.text}`）をそのまま表示する（閲覧は許可）
  - メモが無い画像に表示される「＋ メモ」のホバー誘導は、`canEditMemo`がfalseのとき表示しない

### バックエンドAPI（UI非表示に加えて必ず併用する）

- **`app/api/memos/route.ts`**: `POST`ハンドラの未ログインチェック直後に、`canEditMemos(getRole(session.user.email))`がfalseなら403 `{ error: "権限がありません" }`を返す。`GET`は閲覧許可のため変更なし
- **`app/api/folder-tags/route.ts`**: 同様に`POST`ハンドラに`canUseFolderTagFeature`による403チェックを追加。`GET`は変更なし
- **`app/api/folder-tag-count/route.ts`**: 同様に`POST`ハンドラに`canUseFolderTagFeature`による403チェックを追加。`GET`は変更なし

## データフロー

元設計と同じ。`app/page.tsx`でロールから各capabilityを算出しpropsで配布、各APIルートはリクエストごとに`auth()` → `getRole()`で個別判定する。

## エラーハンドリング

元設計と同じパターン（403 `{ error: "権限がありません" }`）。UIは操作系のボタンを非表示にするため、通常操作で制限付与ユーザーがエラーを見ることはない。

## テスト方針

自動テストは存在しないため、実装後に手動確認する（元設計のTask 6検証に追加する形）。

1. 制限付与ユーザーでログイン → 🔢トグルボタンが非表示、本目タブ・本目割り当てボタンが出ない
2. 同ユーザーで、既にメモが付いている画像のサムネイルにメモ本文が表示されること、クリックしても編集モーダルが開かないこと
3. メモが無い画像に「＋ メモ」の誘導が出ないこと
4. サイドバーの「📝 メモ追加/編集」「📝 メモ削除」ボタンが選択時にも出ないこと
5. devtoolsから `POST /api/memos`, `POST /api/folder-tags`, `POST /api/folder-tag-count` を叩くと403が返ること
6. 管理者・一般ユーザーでは上記いずれも従来通り利用できること

## スコープ外

- 本目バッジ・メモ本文といった「既存データの表示」自体を隠すこと（今回は閲覧は許可する方針）
- メモ・本目タグの過去データを制限付与ユーザーに対してのみフィルタする等のデータ側の制御（表示/操作のUI・API制御のみ）
