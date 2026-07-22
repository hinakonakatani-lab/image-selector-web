---
name: collect-by-theme
description: ユーザー指定のテーマ/キーワードから、タグ付け済み画像を集めてギャラリーHTMLで提案する。まず構造化フィルタで絞り、次に Claude が意味的にテーマ適合順へ精査する（2段構え）。読み取り専用・アプリの relay API 経由。
---

# collect-by-theme

## 前提
- Redis へは直接アクセスしない。`scripts/read-labels.mjs` はアプリの relay API（`/api/labels-shared`）経由で読み取りのみ行う。
- 必要な設定：
  - **`LABELS_API_BASE`**（env・非秘密）: デプロイ済みアプリの URL（例 `https://<deployment>.vercel.app`）
  - **キーチェーン項目 `image-selector-labels-token`**: 用途限定トークン（`LABELS_INGEST_TOKEN`）

## 手順
1. ユーザーからテーマ/キーワードを受け取る（例「明るい北欧風のリビング」）。
2. テーマを構造化条件に分解（例 scene=屋内, place≈リビング）。曖昧語は条件を緩める。
3. 全ラベルを取得: `node scripts/read-labels.mjs` → items 配列。
4. **1段目（機械フィルタ）**: filter.mjs の filterByCriteria 相当で候補を絞る
   （place/subject は部分一致）。
5. **2段目（意味精査）**: 候補が多い場合、各候補のサムネを（必要なら）確認しつつ、
   Claude がテーマ適合度で並べ替え・取捨選択する。
6. 各候補の thumbnailLink(=s1024) を取得してスクラッチにサムネ保存し、tiles を作る:
   `[{fileId, title, thumbPath, viewUrl: "https://drive.google.com/file/d/<fileId>/view", label}]`
   （thumbById / viewUrl は list-images や Drive メタから）。
7. ギャラリー生成:
   `echo '<tiles json>' | node scripts/build-gallery.mjs "<theme>" <scratch>/gallery.html`
8. 生成した HTML を開いてユーザーに提案する（`open <path>` 等）。

## 注意
- 読み取りのみ。Redis へは書き込まない。
