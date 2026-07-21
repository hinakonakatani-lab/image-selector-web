---
name: normalize-vocab
description: 蓄積したタグ語彙（place/subjects/freeTags）の表記ゆれを検出し、人間承認のうえ統合して Redis を更新する。並列タグ付けで生じたゆれを後処理で吸収する。
---

# normalize-vocab

## 手順
1. 対象フィールドを選ぶ（place / subjects / freeTags）。
2. `node scripts/vocab-report.mjs <field>` で「値: 出現数」の一覧を取得。
3. Claude が意味的に同一とみなせる表記の統合案（例 {"エントランス":"玄関"}）を提示する。
4. **ユーザーの承認**を得る（誤統合防止。承認された分だけ適用）。
5. 承認された mergeMap で更新:
   - `node scripts/read-labels.mjs` で全 items を取得
   - `applyMerges(items, field, mergeMap)` 相当の変換を行い、folderId ごとに
     `{fileId: label}` へ再構成
   - folderId ごとに `node scripts/write-labels.mjs <folderId>` で書き戻す
6. 再度 `vocab-report` を実行し、統合が反映されたことを確認。

## 注意
- 書込先は labels:shared:* のみ。件数の増減が無い（統合のみ）ことを確認する。
