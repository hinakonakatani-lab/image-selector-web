# scripts: 画像タグ付け＆テーマ収集ワークフロー

このディレクトリには、画像のタグ付け・語彙の表記ゆれ統一・テーマ収集を行うための、
コアライブラリ・コマンドラインツール・スキル連携が入っています。

## 環境変数

スクリプトは実行時に `process.env` から認証情報を読みます。

**方針（重要）: トークンをローカルに一切保存しません。**
Vercel に設定済みの環境変数を、**実行のたびに Vercel からメモリに取得**して使います。
`.env` / `.env.local` などのファイルにトークンを書き出すことはしません（`vercel env pull <ファイル名>`
のようにファイルへ落とす使い方は禁止）。

### 使う環境変数

**Redis / Vercel KV（必須）**
- **`KV_REST_API_URL`**: Upstash Redis の REST エンドポイント
- **`KV_REST_API_TOKEN`**: Upstash Redis の書き込み用トークン

**Google Drive OAuth（Path 2 では必須／Path 1 のみなら不要）**
- **`GOOGLE_CLIENT_ID`** / **`GOOGLE_CLIENT_SECRET`** / **`GOOGLE_REFRESH_TOKEN`**

これらはすべて **Vercel のプロジェクト環境変数**に設定しておき、ローカルには保存しません。
（Vercel ダッシュボード → プロジェクト → Settings → Environment Variables で確認・設定）

### ディスクに残さず Vercel から取得して実行する

`vercel env pull` の出力先を `/dev/stdout` にすると、dotenv 形式が標準出力（パイプ＝メモリ）に
流れ、実ファイルには書き込まれません。これをそのシェルに読み込み、コマンドを実行します：

```bash
# トークンをファイルに残さず、Vercel からメモリに取り込んで実行する例
set -a
source <(vercel env pull --environment=production /dev/stdout 2>/dev/null)
set +a
node scripts/read-labels.mjs        # 以降このシェルの子プロセスは env を継承
```

- `--environment` は、対象トークンを設定した環境に合わせる（`production` / `preview` / `development`）。
- 取り込んだ値はそのシェルセッションのメモリ内だけに存在し、ディスクには残りません。
- 別コマンドを続けて実行する場合も、同じシェルで `source` 済みなら再取得は不要。
- 初回は `vercel login` / `vercel link` が必要な場合があります（トークン自体はローカルに保存されません）。

## スキル

### `tag-images`（Task 10）
**目的:** Google Drive の画像を vision で見て、6軸のタグ（人物有無・屋内外・ショット・
場所・被写体など）を付け、Redis の `labels:shared:<folderId>` に保存する。

- 指定フォルダ配下を再帰的に辿る
- 各画像を MCP（Path 1）または OAuth の thumbnailLink（Path 2／ライブ検証は保留中）で取得
- macOS の `sips` で長辺 1024px に縮小
- Claude の vision で複数項目のタグを判定
- 使い捨てサブエージェントで並列処理し、親のコンテキストを汚さない
- タグは都度 Redis に書き込む（冪等：再実行しても既にタグ済みの画像は処理しない）

### `normalize-vocab`（Task 12）
**目的:** タグ語彙（場所名・被写体カテゴリなど）の表記ゆれを、人間承認つきで統一する。

- 既存の Redis ラベルから place / subjects / freeTags の値をすべて集計
- 重複・誤記・同義語を洗い出す
- 統合マップを作り、人間の承認を得る
- 承認された分をラベル全体に適用（マージ方式で、件数は変えず値だけ統一）
- 収集の前に語彙の一貫性を担保する

### `collect-by-theme`（Task 13）
**目的:** テーマ（キーワード）から、タグ済み画像を集めてギャラリーHTMLで提案する。

- 2段構えの絞り込み：まず条件マッチ（場所・被写体・屋内外など）→ 次に意味的な精査
- テーマ名・件数・タグ付きグリッドを含むギャラリーHTMLを生成
- 読み取り専用（Redis には書き込まない）
- Path 1（MCP でDL）／Path 2（OAuth の thumbnailLink）どちらの画像取得にも対応

## ライブラリモジュール

`scripts/lib/` のモジュールはすべて env 不要・テスト済みです：

- **`keys.mjs`**: Redis のキー命名規則（labels:shared:* / vocab:* / scan パターン、SCAN完了判定）
- **`tag-schema.mjs`**: ラベル構造の検証（固定軸: hasPerson・scene・shot／配列: subjects・freeTags・tags）
- **`drive-tree.mjs`**: Drive ツリーの走査（フォルダ/画像の判定、親フォルダ単位のグルーピング）
- **`filter.mjs`**: ラベル群への条件フィルタ（scene・hasPerson・shot、place/subject は部分一致）
- **`vocab.mjs`**: 語彙の出現頻度集計と、統合マップの適用（非破壊）
- **`gallery.mjs`**: 絞り込んだ画像を HTML グリッドに描画（タグをエスケープ・遅延読み込み）
- **`image.mjs`**: `sips`（macOS 標準）で画像を長辺 1024px に縮小
- **`redis.mjs`**: Upstash Redis クライアント。全ラベルの読み取り（SCAN）とフォルダ単位の書き込み（マージ）

## コマンドラインツール

各 CLI はパイプ連携できるよう JSON を出力します：

- **`node scripts/list-images.mjs <rootFolderId>`**
  rootFolderId 配下の Drive ツリーを走査し、`{ byLeaf: { parentId: [{ id, title }, ...] }, thumbById: { id: thumbnailLink } }` を出力

- **`node scripts/read-labels.mjs`**
  Redis の labels:shared:* をすべて読み取り、`[{ folderId, fileId, label }, ...]` を出力

- **`node scripts/write-labels.mjs <folderId>`**
  指定フォルダのラベルを Redis に書き込む（標準入力: `{ fileId: label, ... }`）。既存とマージ（上書き消去しない）

- **`node scripts/vocab-report.mjs [place|subjects|freeTags]`**
  全ラベルから語彙を集計し、`[[値, 頻度], ...]` を頻度降順で出力

- **`node scripts/build-gallery.mjs <theme> <outHtmlPath>`**
  標準入力のタイル配列からギャラリーHTMLを生成（標準入力: `[{ title, viewUrl, thumbPath, label }, ...]`）

## 画像アクセス経路

画像はいずれも長辺 1024px に統一して扱います：

- **Path 1（実証済みのフォールバック）:** MCP `download_file_content` でDL → `sips` でローカル縮小
  状態: ✅ 手動で実証済み。ライブ認証情報なしでも動く
  （注: 写真では `read_file_content` は空を返すため使わない）

- **Path 2（本命）:** OAuth の `thumbnailLink` に `=s1024` を付けて取得
  状態: ⚠️ Google OAuth 認証情報が揃うまでライブ検証は保留
  検証が通れば Path 1 を置き換える（軽くて速いため）

vision に渡す画像は、どの経路でも長辺 1024px に統一します。

## セキュリティ

Drive 連携は **読み取り専用**です：
- `.claude/settings.json` で `mcp__claude_ai_Google_Drive__create_file` と
  `mcp__claude_ai_Google_Drive__copy_file` を明示的に deny（禁止）
- 許可されるのは読み取りとフォルダ走査のみ
- Redis のキーは名前空間で限定（`labels:shared:*` / `vocab:*`）

## 本番運用の前に（保留中のライブ検証）

以下はライブの認証情報・環境が必要で、**まだ実施していません**。
これらが済むまで、このワークフローを「本番検証済み」とは扱わないでください：

- **(a) Redis の往復確認:** 上記「Vercel からメモリに取得」の手順で `KV_REST_API_URL` /
  `KV_REST_API_TOKEN` を読み込んだシェルで `node scripts/write-labels.mjs <folderId>` を実行 →
  `node scripts/read-labels.mjs` で書き込んだラベルが返ることを確認する（トークンはファイルに残さない）。
  実際の Upstash カーソル（数値 vs 文字列 `"0"`）に対する `readAllLabels` の SCAN ループもここで検証される。
- **(b) Path 2 の検証スパイク:** 実際の Drive ファイルで OAuth の `thumbnailLink=s1024` 取得が
  端から端まで動くか確認する。失敗・不安定なら Path 1（MCP `download_file_content` でDL →
  `sips` 縮小 → `Read`）にフォールバックする（こちらは実証済み）。
- **(c) 小規模な実フォルダ実行:** 実際の Drive フォルダ1つで `tag-images` と `collect-by-theme` を
  小さく通し、単体テストだけでなくパイプライン全体が期待どおり動くか確認する。
- **(d) Drive 書込ツール deny の実効確認:** Claude Code を再読み込みした後、`create_file` /
  `copy_file` が `.claude/settings.json` どおり実際に拒否されるか（設定だけでなく実効か）確認する。

これらは安全性・実運用準備のフォローアップで、単体テスト済みのライブラリコードのブロッカーでは
ありませんが、いずれもまだ未実施です。

## フェーズC：アプリ統合（対象外）

別計画として今後に予定：
- shared キーのラベルを使う UI コンポーネント（実行時に Redis からラベル取得）
- コレクション表示（ギャラリー＋テーマ情報をアプリ内に表示）
- 現時点では保留。フェーズA（スキーマ＋タグ付け）とフェーズB（統一＋収集）は完了済み。

## テスト

全単体テストを実行（env 不要）：

```bash
node --test scripts/lib/*.test.mjs
```

期待される結果：8モジュールにわたり 22 件のテストが pass。

各モジュールは公開関数をエクスポートし、対応する `.test.mjs` を持ちます：
- **keys.test.mjs**: Redis キー命名・SCAN完了判定
- **tag-schema.test.mjs**: ラベル検証と固定軸の候補
- **drive-tree.test.mjs**: ツリー走査とリーフのグルーピング
- **filter.test.mjs**: 条件マッチ（scene・place・subject）
- **vocab.test.mjs**: 頻度集計と統合の適用
- **gallery.test.mjs**: エスケープつきHTML描画
- **image.test.mjs**: 長辺1024pxへの縮小
- **redis.test.mjs**: ラベルのマージ

---

**ブランチ:** `feature/image-tagging-theme-collection`（main にマージ済み）
**タスク:** 1〜14（フェーズA スキーマ、フェーズB タグ付け＋統一＋収集）
