# フォルダ内タグ検索機能 — 設計書

- 日付: 2026-07-24
- ステータス: ドラフト（ユーザーレビュー待ち）
- 対象リポジトリ: `image-selector-web`（Next.js / Google Drive / Upstash Redis）

## 1. 背景・目的

`tag-images` スキルにより、物件写真に6軸タグ（`hasPerson`/`scene`/`shot`/`place`/
`subjects`/`freeTags`）が `labels:shared:{leafFolderId}` に蓄積されてきた
（2026-07-24時点で複数フォルダ・数百〜数千枚規模）。この蓄積データを、
Webアプリ（画像選定ツール）上で**検索して画像を表示できるように**する。

`collect-by-theme` スキル（Claude Codeエージェントが実行し静的HTMLを生成する）とは
動作環境が異なる。今回は**ブラウザ上でユーザー自身がフィルタを操作する**機能。

## 2. スコープ

- 検索範囲: **現在開いているフォルダ内のみ**（全フォルダ横断はスコープ外）。
- 検索UI: **構造化フィルタ**（自由文テーマ入力によるvision再絞り込みは行わない。
  API課金・レイテンシが発生するため）。
- 結果表示: **既存 `ImageGrid` をそのまま再利用**（選択・色タグ付け・ZIP一括DLなど
  既存機能が絞り込み結果に対してもフル動作する）。

## 3. データモデル

### 3.1 既存スキーマの参照（変更なし）

`scripts/lib/tag-schema.mjs` の型をそのまま使う。混同を避けるため、
アプリ側TypeScriptでは既存の `ImageLabel`（`bigTheme/specificTheme/tags`、
`ThemeAnalysis.tsx`用）と区別して **`SharedLabel`** 型を新設する。

```ts
type SharedLabel = {
  hasPerson?: "人物あり" | "人物なし";
  scene?: "屋内" | "屋外";
  shot?: "寄り" | "引き";
  place?: string;
  subjects?: string[];
  freeTags?: string[];
};
```

### 3.2 同義語辞書（新規）

検索時のみ同義語を吸収する。**タグ付け側のデータは一切変更しない**
（`normalize-vocab` によるデータ自体の統合とは別レイヤー）。

`config/tag-synonyms.json`:

```json
[
  { "canonical": "バルコニー", "synonyms": ["ベランダ"] },
  { "canonical": "洗面室", "synonyms": ["洗面所"] }
]
```

- `canonical`: 実データに存在する（と想定される）代表表記。
- `synonyms`: ユーザーが検索時に打ちそうな別表記。
- グループはフィールド（place/subjects/freeTags）を区別せず1つのリストで管理する
  （ある語がどのフィールドの値かはデータ側が決めるため、辞書側で分ける必要はない。
  無関係なフィールドに展開されても部分一致でヒットしないだけで実害はない）。

初期シード内容（実データの頻度集計から作成、実装時に `config/tag-synonyms.json`
としてそのまま投入する）:

```json
[
  { "canonical": "バルコニー", "synonyms": ["ベランダ"] },
  { "canonical": "洗面室", "synonyms": ["洗面所"] },
  { "canonical": "収納スペース", "synonyms": ["収納部屋", "納戸"] },
  { "canonical": "ワークスペース", "synonyms": ["書斎", "スタディコーナー"] },
  { "canonical": "ウォークインクローゼット", "synonyms": ["WIC", "ウォークインクロゼット"] },
  { "canonical": "シューズクローク", "synonyms": ["シューズクロゼット", "SC"] },
  { "canonical": "土間収納", "synonyms": ["土間"] },
  { "canonical": "ファミリークローゼット", "synonyms": ["ファミクロ", "FC"] },
  { "canonical": "ランドリールーム", "synonyms": ["洗濯室", "ユーティリティ"] },
  { "canonical": "玄関", "synonyms": ["エントランス"] },
  { "canonical": "壁面ニッチ", "synonyms": ["ニッチ"] },
  { "canonical": "一戸建て住宅", "synonyms": ["戸建て", "一戸建て"] },
  { "canonical": "収納棚", "synonyms": ["棚", "シェルフ"] },
  { "canonical": "押入れ", "synonyms": ["押し入れ"] },
  { "canonical": "モデルハウス", "synonyms": ["モデルルーム"] },
  { "canonical": "レトロ", "synonyms": ["アンティーク"] },
  { "canonical": "開放的", "synonyms": ["開放感"] }
]
```

以降、実運用で「検索しても出てこない」ケースが見つかるたびに追記していく
運用（`normalize-vocab` の語彙集計を流用して定期的に見直すのが望ましいが、
それ自体は本機能のスコープ外）。

## 4. アーキテクチャ

```
page.tsx（タブ: select / theme / tagsearch ←新規）
  └─ TagSearchPanel.tsx（新規）
       ├─ 初回: GET /api/tag-vocab?folderId=...   → フィルタ候補（件数付き）取得
       └─ 変更のたび: POST /api/tag-search        → 該当 fileId 一覧を取得
                                                   ↓
       クライアント側で fileId を既存の folders（画像一覧）と突き合わせて絞り込み
                                                   ↓
                              <ImageGrid images={絞り込み結果} />  ← 既存コンポーネント無改修
```

- 新規APIは2本とも **NextAuthセッション認証**（既存 `/api/colors` 等と同じ方式）。
  CLI専用の `/api/labels-shared`（Bearerトークン）とは別物。
- サーバー側はDriveに一切アクセスしない。クライアントが既に持っている
  **リーフフォルダID一覧**（`folders[].id`）をリクエストに含めて送る。
  サーバーは該当リーフの `labels:shared:{leafId}` を読むだけ。

## 5. API仕様

### 5.1 `GET /api/tag-vocab?folderId=<rootId>&leafIds=<id1,id2,...>`

- 指定リーフID群について **`labels:shared:{leafId}` を個別キーで直接GET**する
  （他フォルダのデータまで含む全件SCANはしない。既存 `/api/labels-shared` のGETは
  全件SCAN方式だが、これはCLIの全件取得用途に最適化されたものであり、
  今回のフォルダ限定検索には転用しない）。読んだ結果を合成し、place/subjects/freeTagsごとに
  「値・件数」を集計して返す（`scripts/lib/vocab.mjs` の `collectVocab` を再利用）。
- 同義語グループが存在する値は、グループ内で**代表表記に件数を合算**して1件として返す
  （「バルコニー(12件)」のみ表示、「ベランダ」は候補に出さない＝入力補完のときだけ
  ベランダ→バルコニーへ誘導する）。
- レスポンス例:
```json
{
  "place": [{ "value": "リビング", "count": 42 }, ...],
  "subjects": [{ "value": "バルコニー", "count": 12 }, ...],
  "freeTags": [{ "value": "ナチュラル", "count": 30 }, ...]
}
```

### 5.2 `POST /api/tag-search`

- リクエストボディ:
```json
{
  "leafIds": ["leafA", "leafB"],
  "criteria": {
    "scene": "屋内",
    "hasPerson": "人物なし",
    "shot": "引き",
    "place": "リビング",
    "subjects": ["畳", "観葉植物"],
    "freeTags": ["ナチュラル"]
  }
}
```
  （各キーは省略可＝条件なし）
- サーバー処理:
  1. `leafIds` ごとに `labels:shared:{leafId}` を**個別キーでGET**する
     （§5.1と同じく全件SCANはしない）。
  2. 拡張した `filterByCriteria`（§6）で絞り込み。
  3. 該当 `fileId` の配列を返す。
- レスポンス: `{ "fileIds": ["...", "..."] }`

## 6. 既存ロジックの拡張（`scripts/lib/filter.mjs`）

現状 `filterByCriteria` は `freeTags` 条件に未対応。今回追加する。
また `place`/`subjects`/`freeTags` の部分一致判定に、新設する
`scripts/lib/synonyms.mjs` の `expandTerm(term, groups)` を組み込み、
検索語を同義語込みで展開してから `includes` 判定する。

- 軸内OR・軸間AND（`subjects: ["畳","観葉植物"]` → どちらかを含む画像。
  さらに `place` 指定があれば、それも満たす画像のみ）。
- `filter.mjs`・`synonyms.mjs` はNode.js（CLIスクリプト）・Next.js APIルート
  双方から**同一ファイルをそのままimport**して使う（ロジックの二重実装をしない）。

## 7. UI（`TagSearchPanel.tsx`）

- `scene`/`hasPerson`/`shot`: トグルボタン（値が3種以下の固定語彙のため）。
- `place`/`subjects`/`freeTags`: オートコンプリート付きの入力欄。
  - 入力すると `/api/tag-vocab` で取得済みの候補（件数付き）から部分一致をその場で絞り込み表示。
  - 選択するとチップとして表示（削除可能）。
  - よく使う上位タグ（件数上位5〜8件程度）は入力前から**クイック選択ボタン**として提示。
- 条件変更のたびに `/api/tag-search` を呼び、結果件数・`ImageGrid` を即時更新
  （明示的な「検索」ボタンは置かない）。

## 8. エラー処理

- フォルダ未選択の状態で `tagsearch` タブを開いた場合: フォルダ選択を促す表示。
- 対象フォルダの全リーフに `labels:shared` が存在しない（未タグ付け）場合:
  「このフォルダはまだタグ付けされていません」という空状態メッセージ。
- API呼び出し失敗時: エラーメッセージを表示し、直前の結果表示は維持する
  （黙って結果を消さない）。
- `config/tag-synonyms.json` が不正・読み込み失敗した場合: 同義語展開なしで
  フォールバック動作させる（検索機能自体は止めない）。

## 9. テスト

- `scripts/lib/synonyms.test.mjs`（新規）: `expandTerm` がグループ内語を正しく
  展開すること、グループ外の語はそのまま1件だけ返すこと。
- `scripts/lib/filter.test.mjs`（既存に追記）: `freeTags` 条件、同義語展開込みの
  `place`/`subjects` 部分一致のテストケースを追加。
- 手動確認: 実データのあるフォルダで開発サーバーを起動し、フィルタの絞り込み結果が
  正しいこと、`ImageGrid` の選択・色タグ付け・ZIP一括DLが絞り込み結果に対して
  問題なく動作することを確認する。

## 10. スコープ外（今回やらないこと）

- 全フォルダ横断検索。
- 自由文テーマ入力からのvision再絞り込み（`collect-by-theme` スキルの担当領域）。
- 同義語辞書の管理UI（当面は `config/tag-synonyms.json` を直接編集）。
- 既存データの表記ゆれそのものの統合（`normalize-vocab` スキルの担当領域）。

## 11. 完了条件

- 指定フォルダを開いた状態で「タグ検索」タブに切り替え、構造化フィルタで
  該当画像を絞り込める。
- 絞り込み結果に対して、既存 `ImageGrid` の選択・色タグ付け・ZIP一括DLが
  そのまま機能する。
- 「ベランダ」で検索して「バルコニー」タグの画像がヒットするなど、
  同義語辞書に登録した語で検索できることを確認できる。
