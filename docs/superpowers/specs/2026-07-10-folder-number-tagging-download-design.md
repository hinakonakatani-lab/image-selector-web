# 「本目」フォルダ振り分け＆フォルダ単位ダウンロード 設計

## 概要

画像選定ツールに、選定済み画像を「{数字}本目」という論理フォルダに振り分け、そのフォルダ階層を保ったままダウンロードできる機能を追加する。命名は動画・投稿の納品単位（例：クライアントによって5本、12本など納品数が異なる）を想定している。

## ゴール

- 画像を「1本目」「2本目」...「N本目」（Nはクライアントごとに設定可能）のいずれか1つに振り分けられる
- どの画像がどの本目に振り分けられているか、一覧上で常に視認できる
- 本目ごとに絞り込み表示ができ、そこでダウンロード用のファイル名を手動で変更できる
- 本目ごとに個別ダウンロード（ZIP）、または全本目を一括で階層付きZIPダウンロードできる
- Google Drive上の実データ・フォルダ構造には一切書き込みを行わない

## 非ゴール（今回やらないこと）

- Google Drive上に実フォルダを作成する機能
- 1画像を複数の本目に同時に属させる機能
- ファイル名の自動リネーム（`4-1`のような自動採番）— リネームは完全に手動入力のみ
- 色ラベル（既存の候補/NG選定機能）との連動・自動反映

## データモデル（Redis）

既存の `colors:shared:{folderId}`（`app/api/colors/route.ts`）と同じ命名パターンで、Google Driveの実フォルダ（`folderId`）ごとに以下を保存する。ユーザー個別ではなく `shared` とし、チームで共有する。

| Redisキー | 型 | 内容 |
|---|---|---|
| `folderTagCount:{folderId}` | `number` | この本目タブ機能で表示する最大本目数（例: 12）。未設定時のデフォルトは5 |
| `folderTags:shared:{folderId}` | `Record<fileId, number>` | 画像がどの本目に属するか。1画像1エントリのみ（新しい本目を選ぶと上書き） |
| `renameMap:shared:{folderId}` | `Record<fileId, string>` | ダウンロード時に使うカスタムファイル名（拡張子なし）。キーが存在しない場合はDrive上の元ファイル名を使用 |

## APIルート

既存の `app/api/colors/route.ts` と同じ構造で新設する。

- `GET/POST /api/folder-tags?folderId=...`
  - `GET`: `{ folderTags: Record<fileId, number> }` を返す
  - `POST`: `{ folderId, fileId | fileIds, tag: number | null }` を受け取り保存（`tag: null`でタグ解除）
- `GET/POST /api/folder-tag-count?folderId=...`
  - `GET`: `{ count: number }` を返す（未設定時 `5`）
  - `POST`: `{ folderId, count }` を保存
- `GET/POST /api/rename-map?folderId=...`
  - `GET`: `{ renameMap: Record<fileId, string> }` を返す
  - `POST`: `{ folderId, fileId, name: string | null }` を保存（`name: null`で元のファイル名に戻す）

## UI・操作フロー（`app/components/ImageGrid.tsx`）

既存の色タブ（`COLOR_TABS`、`activeTab`、`colorViewMode`）と並行する形で実装する。

1. **モード切り替え**：色タブバーの近くに「🔢 本数振り分けモード」トグルボタンを追加。ON時、タブバーの内容が `1本目 / 2本目 / ... / N本目`（Nは`folderTagCount`）に切り替わる
2. **本数設定**：モードトグルの横に⚙️アイコン。クリックでインライン数値入力を表示し、`folderTagCount`を更新（既存の`editingMonth`インライン編集と同じUXパターン）
3. **タグ付け操作**：画像を選択 → 番号タブをクリック → 選択中の画像に本目タグを適用（既存`applyColor`と同じ関数構造で`applyFolderTag(tag: number | null)`を新設）
4. **常時バッジ表示**：モードのON/OFFに関わらず、本目タグが付いた画像のサムネイル右上に番号バッジを表示（例：小さい丸に「4」）
5. **本目フィルタ表示**：番号タブクリックで、既存の`filteredColorTabFolders`と同じ仕組みで「その本目の画像のみ」に絞り込み
6. **手動リネーム欄**：本目フィルタ表示中、各サムネイル下に小さいテキスト入力欄を表示。入力値が`renameMap`に保存される。プレースホルダーには元のファイル名を表示し、空欄なら元のファイル名を使う旨を明示

## ダウンロード・ZIP生成

新規APIルート `app/api/drive/download-zip/route.ts` を追加する。

- **リクエスト**：`{ files: { fileId: string, folderLabel?: string }[] }`
  - 本目ごとの個別ダウンロード時：その本目の`fileId`一覧のみ、`folderLabel`なし（フラットにZIP化）
  - 全件一括ダウンロード時：全タグ付き画像の`fileId`一覧＋各々の`folderLabel`（例: `"1本目"`）を付けて送信し、ZIP内で`{folderLabel}/{filename}`という階層を作る
- **ファイル名解決**：`renameMap`にエントリがあれば `{カスタム名}.{元の拡張子}`、なければ`meta.data.name`（既存`download/route.ts`と同じ`drive.files.get({fields:"name,mimeType"})`で取得した名前）をそのまま使用
- **並列取得**：既存`handleBulkDownload`のような直列ループではなく、`Promise.all`（同時実行数を適度に制限、例: 一度に10件程度）でDriveから並列取得してからZIPに追加する
- **ZIP生成**：既存の未使用依存`jszip`を使用。`zip.generateAsync({ type: "arraybuffer" })`でバイナリを生成し、`Content-Disposition: attachment; filename="....zip"`で返す
- **UIボタン**：
  - 本目フィルタ表示中に「この本目をダウンロード」ボタン
  - 本数振り分けモードの上部に「全てダウンロード」ボタン

## エラー処理

- 個々のDriveファイル取得が失敗しても処理を止めず、成功した分だけZIPに含めて返す
- 失敗件数がある場合はレスポンスに `{ failedCount: number }` を含め、クライアント側で「◯件のダウンロードに失敗しました」とアラート表示する
- 全件失敗した場合は500エラーを返し、クライアントは通常のエラートースト表示にフォールバックする

## テスト観点

- `folderTagCount`のデフォルト値（未設定時5）が正しく返る
- 同一画像に対して本目タグを再度別の番号で保存すると、古い番号のタグが上書きされる（残らない）こと
- 本目フィルタ表示時、その本目以外の画像が表示されないこと
- リネーム未入力の画像はZIP内で元のファイル名（元の拡張子付き）になっていること
- 一括ダウンロードZIPの中身が `1本目/`, `2本目/` ...のディレクトリに正しく分かれていること
- Drive取得の一部失敗時にも、成功分のZIPダウンロードが完了すること
