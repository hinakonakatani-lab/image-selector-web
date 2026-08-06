---
name: tag-images
description: Google Drive フォルダ配下の画像を Claude の vision で見てタグ付けし、Redis(labels:shared) に蓄積する。未タグのみ処理し中断再開できる。画像は読み取りのみ（削除・変更しない）。
---

# tag-images

## 前提
- Drive は読み取り専用。`.claude/settings.json` で create_file/copy_file を deny 済みであること。
- Redis へは直接アクセスしない。`scripts/*.mjs` はアプリの relay API 経由で読み書きする。
- 必要な設定：
  - **`LABELS_API_BASE`**（env・非秘密）: デプロイ済みアプリの URL（例 `https://<deployment>.vercel.app`）
  - **キーチェーン項目 `image-selector-labels-token`**: 用途限定トークン（`LABELS_INGEST_TOKEN`）
  - **キーチェーン項目 `image-selector-google-oauth`**: Drive 読み取り用 OAuth（`list-images` / `plan-batches` が使う）

## 絶対に守ること: サブエージェントに Redis を直接書かせない

`/api/labels-shared` の POST は read-modify-write（get → merge → set）でアトミックでない。
**同一フォルダへ並列に書くと lost update が起きる。**
実測: 同一キーへ 8 件を並列投入 → **2 件しか残らなかった（6 件が無音で消失）**。

大きいリーフは 1 フォルダを何十バッチにも分割するため、各エージェントに書かせると
そのフォルダのタグが大量に消える。エラーも出ないので気づけない。

したがって:
- タグ付けエージェントは結果を **ファイルに書き出す**だけ（`scripts/write-labels.mjs` を呼ばせない）
- 書込は **リーフごとに 1 回、順次** `scripts/merge-and-write.mjs` で行う

## タグ構造（軸）
各画像に次を付ける（既存 bigTheme/specificTheme/tags は空のままでよい）:
- hasPerson: 人物あり / 人物なし
- scene: 屋内 / 屋外
- shot: 寄り / 引き
- place: 部屋・場所（既存語彙に該当すれば必ずそれを使う。無い場合のみ新規）
- subjects: 写っている主な被写体（配列。既存語彙に該当すれば必ずそれを使う）
- freeTags: 検索に使える特徴（配列・**上限5個**。下記の制限を必ずプロンプトに入れる）

### freeTags の制限（入れないと語彙が破綻する）
制限なしで大きいバッチを流すと freeTags が 1 枚あたり 4.0 → 14.7 個に膨張し、
56 枚で 44 語もの新規語彙を持ち込んだ（うち `2人`/`夫婦`/`無人`/`外観` は他の軸の言い換え、
`HDR`/`ハイキー` は撮影技法で検索に使えない）。制限を入れると 4.3 個に収まり、
**かつタグ組合せのユニーク率が 21% → 100% に改善した**（1 枚ずつちゃんと差を付けるようになる）。

プロンプトに次を明記する:
- その画像で「テーマ別に写真を集めるとき検索したくなる特徴」だけを書く
- 禁止1: 他の軸の言い換え（`2人` `夫婦` `無人` `屋外` `外観` `外観全景` `引き構図`）
- 禁止2: 撮影技法・画像処理（`HDR` `ハイキー` `露出` `編集済み`）
- 禁止3: 1 枚しか使えない極端に細かい固有名（`モミジ` `ギターケース`）。`植栽` `趣味部屋` のように再利用できる粒度にする
- 該当が少なければ 2〜3 個でよい。無理に 5 個埋めない

## バッチサイズは 24 枚

実測（1 枚あたりトークン）:

| バッチ | 1 枚あたり | 8 枚比 |
| --- | --- | --- |
| 8 枚 | 3,270 | — |
| **24 枚** | **2,165** | **−34%** |
| 32 枚 | 2,020 | −38% |

固定オーバーヘッドが約 15,500 トークン／エージェントあるため、小さいバッチは割高。
24→32 の追加改善は 7% しかなく、1 体あたりの所要時間と失敗時の損失が増えるので **24 枚**を既定とする。
「大きいバッチだと手抜きになる」は実測で否定された（24/24・32/32 とも欠落 0・値域エラー 0）。

## 手順

1. 対象フォルダ ID をユーザーに確認する。

2. バッチ計画を作る:
   ```
   node scripts/plan-batches.mjs <rootFolderId> --batch-size 24 --out <scratchpad>/plan.json
   ```
   これが自動で行うこと:
   - 既タグをスキップ（冪等：増えた分だけ処理される）
   - グレー(NG)判定の画像を除外
   - AppleDouble 残骸（`._` 接頭辞）を除外
   - 同一物件内の同名ファイル（軽量版コピー等）は 1 枚だけ vision 対象にし、
     残りを `propagate`（ラベル複製）に回す＝再認識のコストを払わない

3. `plan.json` の `batches` を 1 件ずつ **使い捨てサブエージェント**（`image-tagger`）に渡す。
   親のコンテキストを画像や結果 JSON で汚さないため、エージェントには次をさせる:
   - 一括ダウンロード（thumbnailLink は署名付き URL で短時間失効するため都度取り直す）:
     `echo '["<fileId1>",...]' | node scripts/download-thumbs.mjs <scratchpad>/<batch名>`
   - 保存された各 jpg を Read して確認し、上記 6 軸を付ける
   - 結果を **ファイルに書き出す**: `<scratchpad>/out/<leafId>/<batch番号>.json`
     （中身は `{ [fileId]: { hasPerson, scene, shot, place, subjects, freeTags } }`）
   - チャットには一行だけ返す。JSON 本体をチャットに貼らせない

4. リーフごとに 1 回、**順次**書込む（並列にしない）:
   ```
   node scripts/merge-and-write.mjs <leafId> <scratchpad>/out/<leafId>
   ```
   このスクリプトが値域検証（`tag-schema`）と重複キーの処理もまとめて行う。

5. `plan.json` の `propagate` を処理する。`fromFileId` のラベルを読んで `toFileId` に複製する
   （vision は不要）。これをやらないと、エディターが別フォルダを開いたときに無タグに見える。
   ラベルはリーフ単位（`labels:shared:{leafId}`）で引かれるため、コピー側にも入れておく必要がある。

6. 途中で失敗しても、2 から再実行すれば未処理分だけ処理される。

## 安全確認
- 実行前に `.claude/settings.json` の deny 設定が有効なことを確認。
- 書込先は labels:shared:* のみ。他キーには触れない。
- 大量処理の前に 1 バッチだけ流し、freeTags 数と欠落件数を確認してから本番に入る。
