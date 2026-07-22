---
name: tag-images
description: Google Drive フォルダ配下の画像を Claude の vision で見てタグ付けし、Redis(labels:shared) に蓄積する。未タグのみ処理し中断再開できる。画像は読み取りのみ（削除・変更しない）。
---

# tag-images

## 前提
- Drive は読み取り専用。`.claude/settings.json` で create_file/copy_file を deny 済みであること。
- Redis へは直接アクセスしない。`scripts/read-labels.mjs` / `write-labels.mjs` はアプリの relay API（`/api/labels-shared`）経由で読み書きする。
- 必要な設定：
  - **`LABELS_API_BASE`**（env・非秘密）: デプロイ済みアプリの URL（例 `https://<deployment>.vercel.app`）
  - **キーチェーン項目 `image-selector-labels-token`**: 用途限定トークン（`LABELS_INGEST_TOKEN`）
  - Path 2 採用時は `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`

## タグ構造（軸）
各画像に次を付ける（既存 bigTheme/specificTheme/tags は空のままでよい）:
- hasPerson: 人物あり / 人物なし
- scene: 屋内 / 屋外
- shot: 寄り / 引き
- place: 部屋・場所（既存語彙に寄せる。無ければ新規）
- subjects: 写っている主な被写体（配列・自由記述、既存語彙に寄せる）
- freeTags: その他の自由タグ（配列）

## 手順
1. 対象フォルダ ID をユーザーに確認する。
2. 画像を列挙: `node scripts/list-images.mjs <folderId>` を実行し `{byLeaf, thumbById}` を得る。
3. リーフフォルダごとに、既存タグを確認:
   `node scripts/read-labels.mjs` の出力から、その folderId で `scene` が入っている fileId を「処理済み」として除外する（冪等）。
   併せて既存の place / subjects 語彙一覧を控える（寄せる先）。
4. 未処理画像を 8 枚程度のバッチに分割。各バッチは **使い捨てサブエージェント**に渡し、親のコンテキストを画像で汚さない。
   サブエージェントへの指示:
   - 各 fileId の thumbnailLink(=s1024) を fetch してスクラッチにサムネ保存
     （Path 1 の場合は MCP download_file_content → ディスク保存 → `node -e` で image.downscale）。
   - サムネを Read して内容を確認し、上記6項目のタグを付ける。place/subjects は渡された既存語彙に寄せる。
   - `{ [fileId]: { hasPerson, scene, shot, place, subjects, freeTags } }` を JSON で返す。
5. サブエージェントの返り値を検証（tag-schema の値域）し、成功分を **都度** 書込:
   `echo '<json>' | node scripts/write-labels.mjs <leafFolderId>`
6. 全リーフ完了までバッチを繰り返す。途中失敗しても、再実行すれば未処理分だけ処理される。

## 安全確認
- 実行前に `.claude/settings.json` の deny 設定が有効なことを確認。
- 書込先は labels:shared:* のみ。他キーには触れない。
