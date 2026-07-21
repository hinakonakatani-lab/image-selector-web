# 画像タグ付け＆テーマ収集スキル 実装計画（フェーズB）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Drive の物件写真を Claude Code の vision（サブスク内・追加課金なし）でタグ付けして Redis に蓄積し、キーワードから該当画像を集めてギャラリーHTMLで提案する Claude Code スキル群を作る。

**Architecture:** vision 判定は Claude Code 本体（Read ツール）が担当。Node の純ロジック/純IO モジュール（`scripts/lib/*.mjs`）が「Drive 一覧取得・画像DL/縮小・Redis 読書き・フィルタ・ギャラリー生成」を担い、3 本の SKILL.md（`tag-images` / `normalize-vocab` / `collect-by-theme`）がそれらを束ねる。Drive は読み取り専用で、書き込み系ツールは deny 設定でブロックする。

**Tech Stack:** Node 20（ESM `.mjs`、組込み `node --test`）、`@upstash/redis`、`googleapis`、macOS `sips`（画像縮小）、Claude Code スキル（SKILL.md）。

## Global Constraints

- Drive は **read-only**。`.claude/settings.json` で `mcp__claude_ai_Google_Drive__create_file` と `mcp__claude_ai_Google_Drive__copy_file` を **deny**。画像の削除・上書きは構造的に不可能に保つ。
- Redis 書込は **`labels:shared:*` と `vocab:*` のみ**。他キー（bookmarks/colors/months/memos/folderTags/renameMap/themes）には一切書き込まない。
- タグ構造は既存 `ImageLabel`（`app/api/labels/route.ts`）を **拡張**し、`bigTheme/specificTheme/tags` は残す（差し替え禁止＝既存 UI を壊さない）。
- labels のキーは **`labels:shared:{folderId}`**（個人専有 `{email}` をやめる）。`folderId` は画像を直接含むリーフフォルダの ID。
- vision に渡す画像は **長辺 1024px** に統一。
- 追加課金 API（Google Vision / Anthropic API）は使わない。vision は Claude Code 本体のみ。
- テストは `node --test`（新規依存の追加なし）。
- 対象外（別計画）：フェーズC（アプリ側 `/api/labels` の shared 化・コレクション表示 UI）。

## File Structure

- Create: `scripts/lib/keys.mjs` — Redis キー生成（`labelsKey`, `VOCAB_PLACES_KEY` 等）＋純関数。
- Create: `scripts/lib/redis.mjs` — Upstash クライアント生成＋labels/vocab の読書きマージ。
- Create: `scripts/lib/drive-tree.mjs` — `search_files` 結果配列 → 再帰フラット化して画像リーフ抽出（純関数）。
- Create: `scripts/lib/image.mjs` — 画像を長辺1024pxへ縮小（`sips` ラッパ）。
- Create: `scripts/lib/tag-schema.mjs` — `ImageLabel` 拡張の形状定義・検証・タグ済み判定（純関数）。
- Create: `scripts/lib/vocab.mjs` — 語彙集計・表記ゆれ統合の差分計算（純関数）。
- Create: `scripts/lib/filter.mjs` — labels 群に対する構造化フィルタ（collect 1段目、純関数）。
- Create: `scripts/lib/gallery.mjs` — ギャラリーHTML文字列生成（純関数）。
- Create: `scripts/list-images.mjs` — CLI: フォルダ配下の画像リーフを JSON 出力（drive-tree を利用、Drive アクセスはスキル側 MCP or OAuth）。
- Create: `scripts/write-labels.mjs` — CLI: 標準入力の labels JSON を `labels:shared:{folderId}` にマージ書込。
- Create: `scripts/read-labels.mjs` — CLI: 全 `labels:shared:*` を scan して JSON 出力。
- Create: `.claude/skills/tag-images/SKILL.md`
- Create: `.claude/skills/normalize-vocab/SKILL.md`
- Create: `.claude/skills/collect-by-theme/SKILL.md`
- Modify/Create: `.claude/settings.json` — deny ルール。
- Tests: `scripts/lib/*.test.mjs`（各純関数モジュール）。

各タスクは独立してテスト可能な成果物で終わる。純ロジックは TDD、Drive/vision/Redis に触る CLI・スキルは手動検証ステップを持つ。

---

## Task 1: Redis キー生成（keys.mjs）

**Files:**
- Create: `scripts/lib/keys.mjs`
- Test: `scripts/lib/keys.test.mjs`

**Interfaces:**
- Produces: `labelsKey(folderId: string): string` → `` `labels:shared:${folderId}` ``、`LABELS_SCAN_PATTERN = "labels:shared:*"`、`VOCAB_PLACES_KEY = "vocab:places"`、`VOCAB_SUBJECTS_KEY = "vocab:subjects"`。

- [ ] **Step 1: 失敗するテストを書く**

```js
// scripts/lib/keys.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { labelsKey, LABELS_SCAN_PATTERN, VOCAB_PLACES_KEY, VOCAB_SUBJECTS_KEY } from "./keys.mjs";

test("labelsKey は shared 名前空間を使う", () => {
  assert.equal(labelsKey("ABC123"), "labels:shared:ABC123");
});
test("scan パターンと語彙キー", () => {
  assert.equal(LABELS_SCAN_PATTERN, "labels:shared:*");
  assert.equal(VOCAB_PLACES_KEY, "vocab:places");
  assert.equal(VOCAB_SUBJECTS_KEY, "vocab:subjects");
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/keys.test.mjs`
Expected: FAIL（`Cannot find module './keys.mjs'`）

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/keys.mjs
export const labelsKey = (folderId) => `labels:shared:${folderId}`;
export const LABELS_SCAN_PATTERN = "labels:shared:*";
export const VOCAB_PLACES_KEY = "vocab:places";
export const VOCAB_SUBJECTS_KEY = "vocab:subjects";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/keys.test.mjs`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/keys.mjs scripts/lib/keys.test.mjs
git commit -m "feat: add redis key builders for shared labels and vocab"
```

---

## Task 2: タグ形状の定義・検証（tag-schema.mjs）

**Files:**
- Create: `scripts/lib/tag-schema.mjs`
- Test: `scripts/lib/tag-schema.test.mjs`

**Interfaces:**
- Produces:
  - `HAS_PERSON = ["人物あり","人物なし"]`、`SCENE = ["屋内","屋外"]`、`SHOT = ["寄り","引き"]`。
  - `isTagged(label: object|undefined): boolean` — 拡張フィールドが埋まっているか（`scene` の有無で判定）。
  - `validateLabel(label: object): {ok: boolean, errors: string[]}` — 固定軸の値が候補内か、配列フィールドが配列か検証。
  - `emptyLabel(): object` — 既存フィールドを空で埋めた初期形（`bigTheme/specificTheme=""`, `tags/subjects/freeTags=[]`）。

- [ ] **Step 1: 失敗するテストを書く**

```js
// scripts/lib/tag-schema.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTagged, validateLabel, emptyLabel, HAS_PERSON, SCENE, SHOT } from "./tag-schema.mjs";

test("isTagged は scene 有無で判定", () => {
  assert.equal(isTagged(undefined), false);
  assert.equal(isTagged({ bigTheme: "" }), false);
  assert.equal(isTagged({ scene: "屋内" }), true);
});

test("validateLabel は固定軸の値域を検証", () => {
  const ok = validateLabel({ hasPerson: "人物なし", scene: "屋内", shot: "引き", place: "和室", subjects: ["畳"], freeTags: [] });
  assert.equal(ok.ok, true);
  const bad = validateLabel({ scene: "宇宙", subjects: "畳" });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 2);
});

test("固定軸の候補", () => {
  assert.deepEqual(HAS_PERSON, ["人物あり","人物なし"]);
  assert.deepEqual(SCENE, ["屋内","屋外"]);
  assert.deepEqual(SHOT, ["寄り","引き"]);
});

test("emptyLabel は既存フィールドを空で持つ", () => {
  const e = emptyLabel();
  assert.equal(e.bigTheme, "");
  assert.deepEqual(e.tags, []);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/tag-schema.test.mjs`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/tag-schema.mjs
export const HAS_PERSON = ["人物あり", "人物なし"];
export const SCENE = ["屋内", "屋外"];
export const SHOT = ["寄り", "引き"];

export const isTagged = (label) => Boolean(label && typeof label.scene === "string" && label.scene.length > 0);

export const emptyLabel = () => ({ bigTheme: "", specificTheme: "", tags: [] });

export function validateLabel(label) {
  const errors = [];
  const inSet = (v, set, name) => { if (v !== undefined && !set.includes(v)) errors.push(`${name} は ${set.join("/")} のいずれか`); };
  inSet(label.hasPerson, HAS_PERSON, "hasPerson");
  inSet(label.scene, SCENE, "scene");
  inSet(label.shot, SHOT, "shot");
  for (const f of ["subjects", "freeTags", "tags"]) {
    if (label[f] !== undefined && !Array.isArray(label[f])) errors.push(`${f} は配列`);
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/tag-schema.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/tag-schema.mjs scripts/lib/tag-schema.test.mjs
git commit -m "feat: add extended ImageLabel schema helpers"
```

---

## Task 3: Drive ツリーの再帰フラット化（drive-tree.mjs）

**Files:**
- Create: `scripts/lib/drive-tree.mjs`
- Test: `scripts/lib/drive-tree.test.mjs`

**Interfaces:**
- Consumes: Drive `search_files` の `files[]`（各要素 `{id, mimeType, title, parentId}`）。
- Produces:
  - `isFolder(f): boolean` / `isImage(f): boolean`（`mimeType` 判定）。
  - `splitChildren(files): {folders: object[], images: object[]}`。
  - `groupImagesByLeaf(imagesWithFolder: {id,title,parentId}[]): Record<string, {id,title}[]>` — parentId（=リーフ folderId）ごとに画像をグルーピング。

- [ ] **Step 1: 失敗するテストを書く**

```js
// scripts/lib/drive-tree.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFolder, isImage, splitChildren, groupImagesByLeaf } from "./drive-tree.mjs";

const folder = { id: "f1", mimeType: "application/vnd.google-apps.folder", title: "5月", parentId: "root" };
const img1 = { id: "i1", mimeType: "image/jpeg", title: "a.jpg", parentId: "f1" };
const img2 = { id: "i2", mimeType: "image/png", title: "b.png", parentId: "f1" };
const img3 = { id: "i3", mimeType: "image/jpeg", title: "c.jpg", parentId: "f2" };

test("種別判定", () => {
  assert.equal(isFolder(folder), true);
  assert.equal(isImage(img1), true);
  assert.equal(isImage(folder), false);
});

test("splitChildren は folders と images に分ける", () => {
  const { folders, images } = splitChildren([folder, img1, img2]);
  assert.equal(folders.length, 1);
  assert.equal(images.length, 2);
});

test("groupImagesByLeaf は parentId ごとにまとめる", () => {
  const g = groupImagesByLeaf([img1, img2, img3]);
  assert.equal(g["f1"].length, 2);
  assert.equal(g["f2"].length, 1);
  assert.equal(g["f1"][0].title, "a.jpg");
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/drive-tree.test.mjs`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/drive-tree.mjs
const FOLDER_MIME = "application/vnd.google-apps.folder";
export const isFolder = (f) => f.mimeType === FOLDER_MIME;
export const isImage = (f) => typeof f.mimeType === "string" && f.mimeType.startsWith("image/");

export function splitChildren(files) {
  const folders = [], images = [];
  for (const f of files) {
    if (isFolder(f)) folders.push(f);
    else if (isImage(f)) images.push(f);
  }
  return { folders, images };
}

export function groupImagesByLeaf(imagesWithFolder) {
  const out = {};
  for (const img of imagesWithFolder) {
    (out[img.parentId] ??= []).push({ id: img.id, title: img.title });
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/drive-tree.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/drive-tree.mjs scripts/lib/drive-tree.test.mjs
git commit -m "feat: add drive tree flattening helpers"
```

---

## Task 4: 構造化フィルタ（filter.mjs）

**Files:**
- Create: `scripts/lib/filter.mjs`
- Test: `scripts/lib/filter.test.mjs`

**Interfaces:**
- Consumes: labels マップの集合 `Array<{folderId, fileId, label}>`（read-labels の出力を平坦化した形）。
- Produces: `filterByCriteria(items, criteria): items[]`。`criteria = {scene?, hasPerson?, shot?, place?(部分一致), subject?(subjects内 部分一致)}`。未指定キーは無条件通過。

- [ ] **Step 1: 失敗するテストを書く**

```js
// scripts/lib/filter.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterByCriteria } from "./filter.mjs";

const items = [
  { folderId: "f1", fileId: "i1", label: { scene: "屋内", place: "リビング", subjects: ["ソファ"] } },
  { folderId: "f1", fileId: "i2", label: { scene: "屋外", place: "外観", subjects: ["庭"] } },
  { folderId: "f2", fileId: "i3", label: { scene: "屋内", place: "和室", subjects: ["畳","窓"] } },
];

test("scene と place(部分一致) で絞る", () => {
  const r = filterByCriteria(items, { scene: "屋内", place: "リビング" });
  assert.equal(r.length, 1);
  assert.equal(r[0].fileId, "i1");
});
test("subject 部分一致", () => {
  const r = filterByCriteria(items, { subject: "窓" });
  assert.deepEqual(r.map((x) => x.fileId), ["i3"]);
});
test("空 criteria は全通過", () => {
  assert.equal(filterByCriteria(items, {}).length, 3);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/filter.test.mjs`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/filter.mjs
export function filterByCriteria(items, criteria = {}) {
  const c = criteria;
  return items.filter(({ label = {} }) => {
    if (c.scene && label.scene !== c.scene) return false;
    if (c.hasPerson && label.hasPerson !== c.hasPerson) return false;
    if (c.shot && label.shot !== c.shot) return false;
    if (c.place && !(label.place ?? "").includes(c.place)) return false;
    if (c.subject && !(label.subjects ?? []).some((s) => s.includes(c.subject))) return false;
    return true;
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/filter.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/filter.mjs scripts/lib/filter.test.mjs
git commit -m "feat: add structured label filter for collection stage 1"
```

---

## Task 5: 語彙集計・統合差分（vocab.mjs）

**Files:**
- Create: `scripts/lib/vocab.mjs`
- Test: `scripts/lib/vocab.test.mjs`

**Interfaces:**
- Produces:
  - `collectVocab(items, field): Map<string, number>` — `field`（"place" は文字列、"subjects"/"freeTags" は配列）の出現頻度。
  - `applyMerges(items, field, mergeMap): items[]` — `mergeMap`（`{旧表記: 正規表記}`）に従って値を置換した新 items を返す（非破壊）。

- [ ] **Step 1: 失敗するテストを書く**

```js
// scripts/lib/vocab.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectVocab, applyMerges } from "./vocab.mjs";

const items = [
  { label: { place: "玄関", subjects: ["ソファ"] } },
  { label: { place: "エントランス", subjects: ["ソファー"] } },
  { label: { place: "玄関", subjects: [] } },
];

test("collectVocab: place 頻度", () => {
  const v = collectVocab(items, "place");
  assert.equal(v.get("玄関"), 2);
  assert.equal(v.get("エントランス"), 1);
});
test("collectVocab: 配列フィールド", () => {
  const v = collectVocab(items, "subjects");
  assert.equal(v.get("ソファ"), 1);
  assert.equal(v.get("ソファー"), 1);
});
test("applyMerges: place を正規化", () => {
  const merged = applyMerges(items, "place", { "エントランス": "玄関" });
  assert.equal(merged[1].label.place, "玄関");
  assert.equal(collectVocab(merged, "place").get("玄関"), 3);
  // 非破壊
  assert.equal(items[1].label.place, "エントランス");
});
test("applyMerges: 配列フィールドも置換", () => {
  const merged = applyMerges(items, "subjects", { "ソファー": "ソファ" });
  assert.deepEqual(merged[1].label.subjects, ["ソファ"]);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/vocab.test.mjs`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/vocab.mjs
export function collectVocab(items, field) {
  const m = new Map();
  const bump = (v) => { if (v) m.set(v, (m.get(v) ?? 0) + 1); };
  for (const { label = {} } of items) {
    const val = label[field];
    if (Array.isArray(val)) val.forEach(bump);
    else bump(val);
  }
  return m;
}

export function applyMerges(items, field, mergeMap) {
  const map = (v) => (v in mergeMap ? mergeMap[v] : v);
  return items.map((it) => {
    const label = { ...(it.label ?? {}) };
    const val = label[field];
    if (Array.isArray(val)) label[field] = [...new Set(val.map(map))];
    else if (val !== undefined) label[field] = map(val);
    return { ...it, label };
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/vocab.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/vocab.mjs scripts/lib/vocab.test.mjs
git commit -m "feat: add vocabulary aggregation and merge helpers"
```

---

## Task 6: ギャラリーHTML生成（gallery.mjs）

**Files:**
- Create: `scripts/lib/gallery.mjs`
- Test: `scripts/lib/gallery.test.mjs`

**Interfaces:**
- Produces: `renderGallery(theme: string, tiles: {fileId, title, thumbPath, viewUrl, label}[]): string` — 自己完結 HTML 文字列。各タイルはローカルサムネ画像・タイトル・Drive リンク・主要タグを表示。

- [ ] **Step 1: 失敗するテストを書く**

```js
// scripts/lib/gallery.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGallery } from "./gallery.mjs";

test("HTML にテーマ・件数・タイルが含まれる", () => {
  const html = renderGallery("明るいリビング", [
    { fileId: "i1", title: "a.jpg", thumbPath: "thumbs/i1.jpg", viewUrl: "https://drive/i1", label: { place: "リビング", scene: "屋内" } },
  ]);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /明るいリビング/);
  assert.match(html, /1\s*件/);
  assert.match(html, /thumbs\/i1\.jpg/);
  assert.match(html, /https:\/\/drive\/i1/);
  assert.match(html, /リビング/);
});

test("HTML エスケープでタグ流し込みを防ぐ", () => {
  const html = renderGallery("<script>x</script>", []);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/gallery.test.mjs`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/gallery.mjs
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function tile(t) {
  const tags = [t.label?.scene, t.label?.place, t.label?.shot, ...(t.label?.subjects ?? [])].filter(Boolean).map(esc).join(" / ");
  return `<figure class="tile">
  <a href="${esc(t.viewUrl)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(t.thumbPath)}" alt="${esc(t.title)}"></a>
  <figcaption><div class="ttl">${esc(t.title)}</div><div class="tags">${tags}</div></figcaption>
</figure>`;
}

export function renderGallery(theme, tiles) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(theme)} — 画像収集結果</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#fafafa;color:#222}
  h1{font-size:18px}.count{color:#666;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
  .tile{margin:0;background:#fff;border:1px solid #eee;border-radius:10px;overflow:hidden}
  .tile img{width:100%;height:170px;object-fit:cover;display:block}
  figcaption{padding:8px}.ttl{font-size:12px;font-weight:600}.tags{font-size:11px;color:#666;margin-top:4px}
</style></head>
<body>
<h1>テーマ: ${esc(theme)}</h1>
<div class="count">${tiles.length} 件</div>
<div class="grid">
${tiles.map(tile).join("\n")}
</div>
</body></html>`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/gallery.test.mjs`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/gallery.mjs scripts/lib/gallery.test.mjs
git commit -m "feat: add self-contained gallery HTML renderer"
```

---

## Task 7: 画像縮小ラッパ（image.mjs）

**Files:**
- Create: `scripts/lib/image.mjs`
- Test: `scripts/lib/image.test.mjs`

**Interfaces:**
- Produces: `async downscale(srcPath: string, outPath: string, longEdge = 1024): Promise<string>` — `sips -Z longEdge` を実行し `outPath` を返す。失敗時は例外。

**Note:** `sips` は macOS 組込み。実画像を使わずに、`sips` を通せる小さな JPEG をテスト内で生成して検証する。

- [ ] **Step 1: 失敗するテストを書く**

```js
// scripts/lib/image.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downscale } from "./image.mjs";

test("downscale は長辺を縮小した画像を出力する", async () => {
  const dir = mkdtempSync(join(tmpdir(), "img-"));
  const src = join(dir, "src.png");
  // 2000x2000 の単色 PNG を sips で生成
  execFileSync("sips", ["-s", "format", "png", "-z", "2000", "2000", "/System/Library/CoreServices/DefaultDesktop.heic", "--out", src]);
  const out = await downscale(src, join(dir, "out.jpg"), 1024);
  assert.ok(existsSync(out));
  const dims = execFileSync("sips", ["-g", "pixelWidth", out]).toString();
  assert.match(dims, /pixelWidth: (\d+)/);
  const w = Number(dims.match(/pixelWidth: (\d+)/)[1]);
  assert.ok(w <= 1024, `width ${w} <= 1024`);
  assert.ok(statSync(out).size > 0);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/image.test.mjs`
Expected: FAIL（`downscale` 未定義）。
※ もし種画像 `DefaultDesktop.heic` が存在しない環境なら、任意の既存 `.jpg/.png` に置き換える（テスト内パスを 1 箇所変更）。

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/image.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const pExecFile = promisify(execFile);

export async function downscale(srcPath, outPath, longEdge = 1024) {
  await pExecFile("sips", ["-Z", String(longEdge), srcPath, "--out", outPath]);
  return outPath;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/image.test.mjs`
Expected: PASS（1 test）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/image.mjs scripts/lib/image.test.mjs
git commit -m "feat: add sips-based image downscale wrapper"
```

---

## Task 8: Redis 読書き（redis.mjs）＋ CLI（read/write-labels）

**Files:**
- Create: `scripts/lib/redis.mjs`
- Create: `scripts/write-labels.mjs`
- Create: `scripts/read-labels.mjs`
- Test: `scripts/lib/redis.test.mjs`（純関数 `mergeLabels` のみ TDD。ネットワーク部分は手動検証）

**Interfaces:**
- Produces:
  - `mergeLabels(existing: object, incoming: object): object` — `{...existing, ...incoming}`（fileId 単位マージ、純関数）。
  - `makeClient(): Redis` — env `KV_REST_API_URL`/`KV_REST_API_TOKEN` から Upstash クライアント生成。
  - `readAllLabels(client): Promise<Array<{folderId,fileId,label}>>` — `LABELS_SCAN_PATTERN` を scan して平坦化。
  - `writeLabels(client, folderId, incoming): Promise<void>` — `labelsKey` に merge 書込。

- [ ] **Step 1: 失敗するテストを書く**

```js
// scripts/lib/redis.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLabels } from "./redis.mjs";

test("mergeLabels は fileId 単位で上書きマージ", () => {
  const existing = { i1: { scene: "屋内" }, i2: { scene: "屋外" } };
  const incoming = { i2: { scene: "屋内", place: "和室" }, i3: { scene: "屋外" } };
  const m = mergeLabels(existing, incoming);
  assert.equal(m.i1.scene, "屋内");
  assert.equal(m.i2.place, "和室");
  assert.equal(m.i3.scene, "屋外");
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/redis.test.mjs`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/redis.mjs
import { Redis } from "@upstash/redis";
import { labelsKey, LABELS_SCAN_PATTERN } from "./keys.mjs";

export const mergeLabels = (existing = {}, incoming = {}) => ({ ...existing, ...incoming });

export function makeClient() {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN が未設定です");
  return new Redis({ url, token });
}

export async function readAllLabels(client) {
  const out = [];
  let cursor = "0";
  do {
    const [next, keys] = await client.scan(cursor, { match: LABELS_SCAN_PATTERN, count: 100 });
    cursor = next;
    for (const key of keys) {
      const folderId = key.slice("labels:shared:".length);
      const map = (await client.get(key)) || {};
      for (const [fileId, label] of Object.entries(map)) out.push({ folderId, fileId, label });
    }
  } while (cursor !== "0");
  return out;
}

export async function writeLabels(client, folderId, incoming) {
  const key = labelsKey(folderId);
  const existing = (await client.get(key)) || {};
  await client.set(key, mergeLabels(existing, incoming));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/redis.test.mjs`
Expected: PASS（1 test）

- [ ] **Step 5: CLI を作成**

```js
// scripts/write-labels.mjs
// usage: node scripts/write-labels.mjs <folderId>  (stdin に {fileId: label} JSON)
import { makeClient, writeLabels } from "./lib/redis.mjs";
const folderId = process.argv[2];
if (!folderId) { console.error("folderId が必要です"); process.exit(1); }
let input = "";
for await (const chunk of process.stdin) input += chunk;
const incoming = JSON.parse(input);
await writeLabels(makeClient(), folderId, incoming);
console.log(`OK: ${Object.keys(incoming).length} 件を labels:shared:${folderId} に書込`);
```

```js
// scripts/read-labels.mjs
// usage: node scripts/read-labels.mjs   → 全 labels:shared:* を JSON 配列で出力
import { makeClient, readAllLabels } from "./lib/redis.mjs";
const items = await readAllLabels(makeClient());
process.stdout.write(JSON.stringify(items, null, 2));
```

- [ ] **Step 6: 手動検証（要 env）**

Run:
```bash
echo '{"__test__":{"scene":"屋内","place":"検証用"}}' | node scripts/write-labels.mjs TESTFOLDER
node scripts/read-labels.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);console.log(a.find(x=>x.fileId==='__test__'))})"
```
Expected: 書込 OK ログ →（読取で）`{ folderId: 'TESTFOLDER', fileId: '__test__', label: { scene: '屋内', place: '検証用' } }`

- [ ] **Step 7: 検証データを削除して確認**

Run:
```bash
node -e "import('./scripts/lib/redis.mjs').then(async m=>{const c=m.makeClient();await c.del('labels:shared:TESTFOLDER');console.log('cleaned')})"
```
Expected: `cleaned`（他キーには触れていないこと）

- [ ] **Step 8: コミット**

```bash
git add scripts/lib/redis.mjs scripts/lib/redis.test.mjs scripts/write-labels.mjs scripts/read-labels.mjs
git commit -m "feat: add redis label read/write library and CLIs"
```

---

## Task 9: 画像列挙 CLI（list-images.mjs）＋ Path 2 検証

**Files:**
- Create: `scripts/list-images.mjs`
- Modify: `docs/superpowers/plans/2026-07-21-image-tagging-theme-collection.md`（検証結果を追記）

**Interfaces:**
- Consumes: `drive-tree.mjs` の `groupImagesByLeaf`。
- Produces: CLI が Drive を BFS 再帰探索して、`{ [leafFolderId]: [{id,title}] }` を JSON 出力。

**設計上の注意（実装者向け）:** Drive アクセス手段は 2 系統ある。
- **本命 Path 2**：ローカル Node が Google OAuth リフレッシュトークン（`GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` を env）で `googleapis` を使い、`files.list`（`q: '"PARENT" in parents'`, `fields: files(id,name,mimeType,parents,thumbnailLink)`）を呼ぶ。画像取得は `thumbnailLink` を `=s1024` に置換して `fetch` → ディスク保存。
- **フォールバック Path 1**：Claude Code セッションの MCP `search_files` / `download_file_content` を **スキル側から** 使い、フル画像をディスク保存 → `image.downscale`。

`list-images.mjs` は Path 2（OAuth）用に実装する。Path 1 はスキル手順内で MCP を直接使うため CLI 不要。

- [ ] **Step 1: Path 2 検証スパイク（最優先）**

Run（env 設定後）:
```bash
node -e "import('googleapis').then(async ({google})=>{const o=new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET);o.setCredentials({refresh_token:process.env.GOOGLE_REFRESH_TOKEN});const d=google.drive({version:'v3',auth:o});const r=await d.files.list({q:\"'1rjAuDa8OwzoH-haAZ5k53DMEV3mcd_St' in parents\",fields:'files(id,name,mimeType,thumbnailLink)',pageSize:3,supportsAllDrives:true,includeItemsFromAllDrives:true});const f=r.data.files[0];console.log(f.name, f.thumbnailLink?.slice(0,60));const url=f.thumbnailLink.replace(/=s\\d+$/,'=s1024');const res=await fetch(url);console.log('thumb status',res.status,res.headers.get('content-type'));})"
```
Expected（成功時）: 画像名＋thumbnailLink 断片、`thumb status 200 image/jpeg`。
→ **200 が返れば Path 2 採用**。403/401 等なら **Path 1 にフォールバック**し、その旨を本ファイルに追記して Task 10 のスキル手順を Path 1 版で書く。

- [ ] **Step 2: 検証結果を計画に追記**

`docs/.../2026-07-21-image-tagging-theme-collection.md` の末尾に「## Path 検証結果」を追記（採用 Path と根拠）。

- [ ] **Step 3: list-images.mjs 実装（Path 2 採用時）**

```js
// scripts/list-images.mjs
// usage: node scripts/list-images.mjs <rootFolderId>
import { google } from "googleapis";
import { splitChildren, groupImagesByLeaf } from "./lib/drive-tree.mjs";

function driveClient() {
  const o = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  o.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth: o });
}

async function listChildren(drive, parentId) {
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,parents,thumbnailLink)",
      pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) files.push({ id: f.id, title: f.name, mimeType: f.mimeType, parentId, thumbnailLink: f.thumbnailLink });
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function walk(drive, rootId) {
  const images = [], queue = [rootId];
  while (queue.length) {
    const children = await listChildren(drive, queue.shift());
    const { folders, images: imgs } = splitChildren(children);
    images.push(...imgs);
    queue.push(...folders.map((f) => f.id));
  }
  return images;
}

const root = process.argv[2];
if (!root) { console.error("rootFolderId が必要です"); process.exit(1); }
const drive = driveClient();
const images = await walk(drive, root);
const byLeaf = groupImagesByLeaf(images);
// thumbnailLink も保持（=s1024 で使用）
const thumbById = Object.fromEntries(images.map((i) => [i.id, i.thumbnailLink]));
process.stdout.write(JSON.stringify({ byLeaf, thumbById }, null, 2));
```

- [ ] **Step 4: 手動検証**

Run: `node scripts/list-images.mjs 1rMMCKkIGZ5my9etToCBEf4hxOcUaH4Xh | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log('leaves:',Object.keys(o.byLeaf).length,'images:',Object.values(o.byLeaf).flat().length)})"`
Expected: リーフ数・画像総数が出力される（0 でない）。

- [ ] **Step 5: コミット**

```bash
git add scripts/list-images.mjs docs/superpowers/plans/2026-07-21-image-tagging-theme-collection.md
git commit -m "feat: add drive image listing CLI (Path 2) and record path verification"
```

---

## Task 10: スキル tag-images（SKILL.md）

**Files:**
- Create: `.claude/skills/tag-images/SKILL.md`

**Interfaces / Consumes:** `scripts/list-images.mjs`、`scripts/write-labels.mjs`、`scripts/lib/image.mjs`、`scripts/lib/tag-schema.mjs`。

- [ ] **Step 1: SKILL.md を作成**

```markdown
---
name: tag-images
description: Google Drive フォルダ配下の画像を Claude の vision で見てタグ付けし、Redis(labels:shared) に蓄積する。未タグのみ処理し中断再開できる。画像は読み取りのみ（削除・変更しない）。
---

# tag-images

## 前提
- Drive は読み取り専用。`.claude/settings.json` で create_file/copy_file を deny 済みであること。
- env: `KV_REST_API_URL` `KV_REST_API_TOKEN`（書込）、Path 2 採用時は `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`。

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
```

- [ ] **Step 2: スキルの読み込み確認**

Run: Claude Code で `/tag-images` が候補に出る、または Skill 一覧に `tag-images` が現れることを確認（`ls .claude/skills/tag-images/SKILL.md`）。
Expected: ファイルが存在し、frontmatter が有効。

- [ ] **Step 3: 小規模実地検証（数枚）**

対象: `1rjAuDa8OwzoH-haAZ5k53DMEV3mcd_St`（画像2枚のリーフ）。スキルを起動し、2枚にタグが付いて `labels:shared:1rjAuDa8OwzoH-haAZ5k53DMEV3mcd_St` に保存されることを確認。
Expected: `node scripts/read-labels.mjs` にその 2 fileId が scene 付きで現れる。再実行で「0 件処理（全て処理済み）」になる（冪等）。

- [ ] **Step 4: コミット**

```bash
git add .claude/skills/tag-images/SKILL.md
git commit -m "feat: add tag-images skill"
```

---

## Task 11: セキュリティ deny 設定

**Files:**
- Create/Modify: `.claude/settings.json`

- [ ] **Step 1: deny ルールを追加**

`.claude/settings.json`（無ければ新規）:
```json
{
  "permissions": {
    "deny": [
      "mcp__claude_ai_Google_Drive__create_file",
      "mcp__claude_ai_Google_Drive__copy_file"
    ]
  }
}
```

- [ ] **Step 2: 有効性を確認**

Claude Code を再読込し、`create_file`/`copy_file` の呼び出しがブロックされること（読み取り系は許可）を確認。
Expected: 書込ツールが deny される。読み取り（search_files 等）は従来どおり可能。

- [ ] **Step 3: コミット**

```bash
git add .claude/settings.json
git commit -m "chore: deny Google Drive write tools (read-only enforcement)"
```

---

## Task 12: スキル normalize-vocab（SKILL.md）

**Files:**
- Create: `.claude/skills/normalize-vocab/SKILL.md`

**Interfaces Consumes:** `scripts/read-labels.mjs`、`scripts/lib/vocab.mjs`、`scripts/write-labels.mjs`。

- [ ] **Step 1: 補助 CLI（vocab 集計）を作成**

```js
// scripts/vocab-report.mjs
// usage: node scripts/vocab-report.mjs <field>   field: place|subjects|freeTags
import { makeClient, readAllLabels } from "./lib/redis.mjs";
import { collectVocab } from "./lib/vocab.mjs";
const field = process.argv[2] || "place";
const items = await readAllLabels(makeClient());
const v = collectVocab(items, field);
const sorted = [...v.entries()].sort((a, b) => b[1] - a[1]);
process.stdout.write(JSON.stringify(sorted, null, 2));
```

- [ ] **Step 2: SKILL.md を作成**

```markdown
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
```

- [ ] **Step 3: 変換の動作確認（純ロジック）**

Run: `node --test scripts/lib/vocab.test.mjs`
Expected: PASS（Task 5 のテストが引き続き通る）

- [ ] **Step 4: コミット**

```bash
git add scripts/vocab-report.mjs .claude/skills/normalize-vocab/SKILL.md
git commit -m "feat: add normalize-vocab skill and vocab report CLI"
```

---

## Task 13: スキル collect-by-theme（SKILL.md）＝ フェーズB 提案

**Files:**
- Create: `.claude/skills/collect-by-theme/SKILL.md`
- Create: `scripts/build-gallery.mjs`

**Interfaces Consumes:** `scripts/read-labels.mjs`、`scripts/lib/filter.mjs`、`scripts/lib/gallery.mjs`、`scripts/list-images.mjs`（thumbById）。

- [ ] **Step 1: ギャラリー生成 CLI を作成**

```js
// scripts/build-gallery.mjs
// usage: node scripts/build-gallery.mjs <theme> <outHtmlPath>   (stdin に tiles JSON 配列)
import { writeFileSync } from "node:fs";
import { renderGallery } from "./lib/gallery.mjs";
const [theme, outPath] = [process.argv[2], process.argv[3]];
if (!theme || !outPath) { console.error("theme と outHtmlPath が必要です"); process.exit(1); }
let input = ""; for await (const chunk of process.stdin) input += chunk;
const tiles = JSON.parse(input);
writeFileSync(outPath, renderGallery(theme, tiles));
console.log(`OK: ${tiles.length} 件を ${outPath} に出力`);
```

- [ ] **Step 2: SKILL.md を作成**

```markdown
---
name: collect-by-theme
description: ユーザー指定のテーマ/キーワードから、タグ付け済み画像を集めてギャラリーHTMLで提案する。まず構造化フィルタで絞り、次に Claude が意味的にテーマ適合順へ精査する（2段構え）。
---

# collect-by-theme

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
```

- [ ] **Step 3: ギャラリー生成の動作確認（ダミーデータ）**

Run:
```bash
echo '[{"fileId":"i1","title":"a.jpg","thumbPath":"x.jpg","viewUrl":"https://drive/i1","label":{"scene":"屋内","place":"リビング"}}]' | node scripts/build-gallery.mjs "テスト" /tmp/g.html && grep -c "リビング" /tmp/g.html
```
Expected: `OK: 1 件...` ログ → `grep` が 1 以上。

- [ ] **Step 4: 実地検証（タグ付け済みフォルダ）**

Task 10 でタグ付けした 2 枚に対し、`collect-by-theme` を「屋内」等のテーマで起動し、ギャラリーHTMLが開いて該当画像が並ぶことを確認。
Expected: ブラウザでサムネとタグが表示される。

- [ ] **Step 5: コミット**

```bash
git add scripts/build-gallery.mjs .claude/skills/collect-by-theme/SKILL.md
git commit -m "feat: add collect-by-theme skill and gallery build CLI"
```

---

## Task 14: 全体テストと README

**Files:**
- Create: `scripts/README.md`

- [ ] **Step 1: 全純ロジックテストを実行**

Run: `node --test scripts/lib/`
Expected: 全モジュールの test が PASS。

- [ ] **Step 2: README を作成**

`scripts/README.md` に、必要な env（`KV_REST_API_URL/TOKEN`、`GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`）の取得方法（`vercel env pull` / OAuth playground 等）、各スキルの使い方、採用した画像アクセス Path、フェーズC が別計画である旨を記載。

- [ ] **Step 3: コミット**

```bash
git add scripts/README.md
git commit -m "docs: add scripts README with env setup and skill usage"
```

---

## Self-Review 結果（spec との対応）

- §4 スキル3本 → Task 10 / 12 / 13。
- §5.1 タグ拡張 → Task 2（形状）＋ Task 10（付与）。既存フィールド保持で後方互換。
- §5.2 shared キー → Task 1 / 8。
- §5.3 語彙 → Task 5 / 12。
- §6 tag-images（再帰・差分・使い捨てサブエージェント・都度書込）→ Task 9 / 10。
- §7 normalize-vocab（後処理・人間承認）→ Task 12。
- §8 画像アクセス（Path 2 本命・1024px・検証してフォールバック）→ Task 9。
- §9 セキュリティ deny → Task 11。
- §10 collect-by-theme（2段構え・ギャラリーHTML）→ Task 13。
- §11 非機能（冪等・並列・分割）→ Task 8/10 手順。
- 対象外: フェーズC（アプリ統合）は別計画。
