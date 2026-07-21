# 画像タグ付け＆テーマ収集スキル — 設計書

- 日付: 2026-07-21
- ステータス: ドラフト（ユーザーレビュー待ち）
- 対象リポジトリ: `image-selector-web`（Next.js / Google Drive / Upstash Redis）

## 1. 背景・目的

Googleドライブに蓄積された物件写真を、テーマ（例「明るい北欧風のリビング」）で
横断的に集めて提案したい。そのために、画像1枚ごとにタグを付けてRedisに蓄積し、
キーワードからタグで収集する仕組みを、**Claude Code のスキル**として実装する。

コスト制約が出発点：画像認識を従量課金API（Google Vision / Anthropic API）で
やると費用がかさむため、**Claude Code のサブスクリプション内の vision** で
画像認識し、追加課金ゼロで運用する。

## 2. 前提（検証済みの事実）

コードとスパイクで確認済み。憶測ではない。

- **Drive スコープは `drive.readonly`**（`auth.ts:12`）。書き込み権限が無いため、
  アプリ経由のアクセスでは画像の削除・変更が構造的に不可能。
- **タグ付け機能は既に実装済みだった**（当初「空の残骸」と誤認していた）。
  - `app/api/analyze/route.ts` … `claude-haiku-4-5` に画像を投げて
    `{ bigTheme, specificTheme, tags[] }` を返す。**`ANTHROPIC_API_KEY`（従量課金）依存**。
  - `app/components/ThemeAnalysis.tsx` … `page.tsx` に組込済み。5枚バッチ、
    分析済みスキップ（差分処理）、テーマ別表示UIまで実装済み。
  - `labels` が空なのは「未実装」ではなく **APIキー未取得で一度も動いていない**ため。
  - → プロンプト・型・保存API・差分ロジック・表示UIは **再利用可能な資産**。
- **`labels` はユーザー個人専有キー**：`labels:{email}:{folderId}`
  （`app/api/labels/route.ts:16`）。他ユーザー（`config/permissions.ts` に約49人）には
  見えない。他の共同編集データ（colors/months/memos/folderTags/renameMap）は全て
  `:shared:` 方式。→ **shared 化が必要**。
- **画像取得のスパイク結果**（フォルダ `1Is2EYi97YENmU9UnN88kEMhOVp17NU0O` で実証）：
  - フォルダ一覧は MCP（`mcp__claude_ai_Google_Drive__search_files`）で取得可。
    ただし **深い入れ子**（`2024 → 月別 → 物件/回数 → 画像`）。再帰探索が必要。
  - `read_file_content`（画像→自然言語）は **写真では空を返す**。使用不可。
  - `download_file_content` は **フルサイズ（例 3MB）** を返し、そのままでは
    トークン超過。**サムネ指定オプションが無い**（超過時はディスクに保存される）。
  - 回避パイプライン **DL→ディスク保存→ローカル縮小(sips 400px/約26KB)→Read** で
    **vision 認識に成功**（和室＋奥のLDKを正しく認識）。
  - → **律速はダウンロード**（毎回フル解像度DL）。1000枚で合計約3GB相当。

## 3. スコープと段階リリース

- **フェーズB（先行）**：タグ付け＋キーワード収集＋**ギャラリーHTML提案**。
  アプリ本体の改修は最小（スキルがRedisへ直接書込・ギャラリーは単独HTML）。
  開発者が動作・精度を確認する。
- **フェーズC（B承認後）**：収集結果を Redis に「コレクション」保存し、
  Webアプリ上で表示。ここで初めてアプリ側（labels読取の shared 化・コレクションUI）を改修。

## 4. アーキテクチャ

責務ごとに **Claude Code スキル 3 本**（Fable 提案の語彙管理分離を採用）：

```
skill①  tag-images         画像を見てタグを付け、Redis(labels:shared)へ蓄積
skill②  normalize-vocab     蓄積タグの表記ゆれを後処理で統一（並列レース回避）
skill③  collect-by-theme    キーワードから画像を集め、ギャラリーHTMLで提案
```

補助として、Redis 読み書き用の小さな Node スクリプト（`@upstash/redis` 使用）を
スキルから呼ぶ。スキルはアプリのAPIを経由せず **Upstash に直接** 読み書きする
（ローカルにアプリのログインセッションが無いため）。

## 5. データモデル

### 5.1 labels の拡張（差し替えず後方互換）

既存 `ImageLabel` を**拡張**する（`bigTheme/specificTheme/tags` は残す。
差し替えると `ThemeAnalysis.tsx`・`/api/themes` が壊れるため）。

```ts
type ImageLabel = {
  // 既存（後方互換のため保持）
  bigTheme: string;
  specificTheme: string;
  tags: string[];
  // 新規拡張（今回の軸）
  hasPerson?: "人物あり" | "人物なし";   // 固定
  scene?: "屋内" | "屋外";               // 固定
  shot?: "寄り" | "引き";                // 固定
  place?: string;                        // ゆるい固定（一覧＋新規可）
  subjects?: string[];                   // 自由記述
  freeTags?: string[];                   // 追加の自由タグ
};
```

新しい軸を後から足すのは、このオブジェクトにキーを1つ追加し、対象画像を
再処理するだけ（既存データは壊れない）。

### 5.2 キーの shared 化

- 保存先を **`labels:shared:{folderId}`** に統一（個人専有をやめる）。
- `folderId` の単位は **画像を直接含むリーフフォルダ（物件/回数フォルダ）**。
- 既存 `labels` はデータが無いため移行コストなし。
- フェーズCで `app/api/labels/route.ts`（GET/POST）と `ThemeAnalysis.tsx` を
  shared 参照に更新する。

### 5.3 場所語彙（canonicalization 用）

- `vocab:places`（Set/配列）と `vocab:subjects` を Redis に保持。
- タグ付け時に既存語彙へ寄せる。並列時のレースを避けるため、
  **語彙の正規化・統合は skill② の後処理**で行う（下記）。

## 6. skill① tag-images（タグ付け）

**入力**: 対象フォルダID（配下を再帰探索）。

**フロー**:
1. MCP で対象フォルダ配下を再帰的に列挙し、画像ファイル（`{fileId, title, parentId}`）を収集。
2. Redis から各リーフフォルダの既存 `labels:shared:{folderId}` を読み、
   **既にタグ済みの fileId はスキップ**（冪等・再開可能）。既存の場所/被写体語彙も読み込む。
3. 未処理画像を **バッチ**単位で処理。各バッチは **使い捨てサブエージェント**に渡し、
   親セッションのコンテキストを画像で汚さない（Fable 指摘）。
4. 各サブエージェントの処理：
   - 画像を取得（§8 の画像アクセスパイプライン）→ ローカル縮小 → Read で認識。
   - `analyze/route.ts` のプロンプトを土台に、§5.1 の軸でタグ生成。
   - 場所は「既存語彙にあれば寄せる」。無ければ新規（正規化は後段）。
5. 成功分を **都度** `labels:shared:{folderId}` にマージ書込
   （既存 `/api/labels` と同じ `{...existing, ...new}` 方式）。
   部分失敗時も成功分は保存され、再実行で残りだけ処理。

**書込手段**: ローカル Node スクリプト＋`@upstash/redis`。
`KV_REST_API_URL` と **書込用 `KV_REST_API_TOKEN`** を `process.env` から使用。
**トークンはローカルに一切保存しない**方針：Vercel に設定済みの環境変数を、実行のたびに
`source <(vercel env pull --environment=production /dev/stdout)` でメモリに取り込む
（`.env` 等のファイルに書き出さない）。

## 7. skill② normalize-vocab（語彙の表記ゆれ統一）

- 全 `labels:shared:*` を `kv.scan`（`admin-backup/route.ts` と同方式）で走査。
- 出現している `place` / `subjects` / `freeTags` の一覧を集計。
- Claude が意味的に同一とみなせる表記（例「玄関」「エントランス」）を統合案として提示。
- **人間承認**を挟んでから統合を適用（語彙の単調肥大・誤統合を防ぐ）。
- 並列タグ付けで生じたレース由来のゆれを、ここで一括吸収する。

## 8. 画像アクセスパイプライン

削除リスクゼロ（読み取りのみ）を絶対条件とする。
判断基準は **「軽い（帯域・トークンが少ない）」かつ「判断品質を落とさない」**。
判断品質は vision に渡す解像度で決まり、どちらの案でも解像度を選べる。
軽さは Path 2 が圧倒的（フル解像度を落とさない）。よって **本命は Path 2**。

- **Path 2（本命・要検証）**:
  ローカル Node スクリプトが Google OAuth リフレッシュトークンを保持し、
  `googleapis` で Drive API を `drive.readonly` で直接呼び、**`thumbnailLink` の
  中サイズ（長辺 `=s1024`）サムネのみ取得** → ディスク保存 → `Read` で vision。
  帯域が小さく高速で、運用も素直。要件はローカルでの OAuth トークン取得手順のみ。
- **Path 1（スパイクで実証済み・フォールバック）**:
  `download_file_content`（フル解像度）→ ディスク保存 → `sips` 等でローカル縮小
  → `Read`。追加セットアップ不要だが、毎回フルDL（1000枚≈3GB）で帯域を消費し、
  「トークン超過時にディスク保存される」挙動に依存する点がやや脆い。

**解像度の標準**: vision に渡す画像は **長辺 1024px 程度**に統一する。
スパイクでは 400px でも和室を正しく認識できたが、被写体の細部（照明の形・小物等）
まで安定判定するため 1024px を標準とする（それでもファイルは約150KB前後で軽量）。

**採用手順**: 実装初期に「ローカルスクリプトが `thumbnailLink`(=s1024) を
OAuth トークンで取得できるか」を検証。通れば Path 2 を採用、失敗時のみ Path 1 に
フォールバックする（Path 1 は実証済みのため保険として残す）。

## 9. セキュリティ要件（必須）

- スキル導入時、`.claude/settings.json` に
  **`mcp__claude_ai_Google_Drive__create_file` と
  `mcp__claude_ai_Google_Drive__copy_file` の deny ルール**を追加し、
  Drive は読み取り系ツールのみ許可（完全 read-only 化）。
- または新大陸OSの読み取り専用 Drive 経路を使う。
- いずれの場合も、画像の削除・上書きが**構造的に不可能**であることを維持する。
- Redis 書込は `labels:shared:*` と `vocab:*` に限定し、他キー（bookmarks/colors 等）は
  触らない。

## 10. skill③ collect-by-theme（収集・提案）

**フロー（2段構え = C）**:
1. ユーザーがテーマ/キーワードを入力。
2. **1段目：構造化フィルタ** … 全 `labels:shared:*` を走査し、
   軸条件（例 `scene=屋内` かつ `place≈リビング`）で候補を機械的に絞る。
3. **2段目：意味的絞り込み** … Claude がテーマ適合度で候補を並べ替え・取捨選択。
4. **フェーズB出力**：該当画像のサムネをタイル状に並べた **ギャラリーHTML** を生成して開く
   （各タイルに Drive の viewUrl リンク・タグ表示）。サムネは §8 と同じ手段で取得。
5. **フェーズC出力**：結果を Redis に「コレクション」として保存し、Webアプリで表示。

## 11. 非機能要件

- **速度/コスト**: vision のトークンは縮小版のみで安価。律速は Drive ダウンロード。
  初回1000枚は十数分〜数十分を見込む。2回目以降は差分のみで高速。
- **冪等性/再開性**: タグ済みスキップ＋成功分の都度書込により、中断・再実行に耐える。
- **並列性**: バッチをサブエージェントで並列処理。上限は Drive DL とレート制限で決まる。
- **サブスク上限**: 1回で大量処理すると利用上限に達しうるため、フォルダ/月単位で
  分割実行できるようにする。

## 12. 既存資産の再利用と後方互換

- 再利用: `analyze/route.ts` のプロンプト、`ImageLabel` 型、`/api/labels` の保存様式、
  `ThemeAnalysis.tsx` の差分/バッチ/表示ロジック。
- 後方互換: `bigTheme/specificTheme/tags` を残すことで既存UIを壊さない。
- フェーズCで labels の shared 化に合わせ、`/api/labels` と `ThemeAnalysis.tsx` を更新。

## 13. 未解決・要判断事項（実装計画で確定）

1. 画像アクセスは **Path 2 を本命**とし、初期検証（thumbnailLink=s1024 取得）が
   通れば採用、失敗時のみ Path 1 にフォールバック。vision 解像度は長辺 1024px 標準。
2. `labels:shared:{folderId}` の `folderId` 単位（リーフ物件フォルダで確定予定）。
3. バッチサイズと並列度の具体値（DL 律速の実測後に決定）。
4. 認証情報（`KV_REST_API_TOKEN` 書込・Google OAuth）は **ローカルに保存せず**、
   実行時に Vercel からメモリへ取得（`vercel env pull /dev/stdout` を source）。保管はしない。
5. ギャラリーHTMLのデザイン（タイル枚数・タグ表示・リンク先）。

## 14. 完了条件（フェーズB）

- 指定フォルダ配下の未タグ画像に、§5.1 の軸でタグが付き `labels:shared:*` に保存される。
- 中断・再実行で未処理分だけが処理される（冪等）。
- キーワードから該当画像を集め、ギャラリーHTMLで提案できる。
- Drive の画像は一切変更・削除されない（deny 設定で担保）。
