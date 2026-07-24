# フォルダ内タグ検索機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画像選定ツールに「タグ検索」タブを追加し、`labels:shared:{leafFolderId}` に蓄積された6軸タグ（hasPerson/scene/shot/place/subjects/freeTags）で、現在開いているフォルダ内の画像を構造化フィルタで絞り込み、既存の `ImageGrid` で表示・操作（選択/色タグ付け/ZIP一括DL）できるようにする。

**Architecture:** `page.tsx` に新タブ `tagsearch` を追加し、新規クライアントコンポーネント `TagSearchPanel.tsx` が2本の新規APIルート（`GET /api/tag-vocab`・`POST /api/tag-search`）を叩いて条件に合う `fileId` を取得、既にクライアント側にある画像一覧（`folders`）から絞り込んだ結果を既存 `ImageGrid` にそのまま渡す。`place`/`subjects`/`freeTags` の検索は同義語辞書（`config/tag-synonyms.json`）で表記ゆれを吸収する。CLIスクリプト側の `filter.mjs`/`vocab.mjs` をNext.js APIルートからそのままimportして再利用する。

**Tech Stack:** Next.js（App Router）/ TypeScript / React / `@upstash/redis` / Node標準 `node:test`（`.mjs`ロジックのみ自動テスト対象、TS/React部分は手動確認）。

## Global Constraints

- 検索範囲は現在開いているフォルダ内のみ（全フォルダ横断はスコープ外）。
- サーバー側の新規APIはNextAuthセッション認証（`auth()`）を使う。CLI専用の`/api/labels-shared`（Bearerトークン）とは別物・混同しない。
- `labels:shared:{leafId}` の読み取りは**個別キーGET**で行う（全件SCANは既存 `/api/labels-shared` のCLI用途に限定し、今回は転用しない）。
- 軸内OR・軸間AND（例: `subjects: ["畳","観葉植物"]` はどちらかを含めばOK。さらに `place` 指定があればそれも満たす画像のみ）。
- 既存 `ImageGrid` コンポーネントの内部ロジックは変更しない（絞り込んだ`folders`配列を渡すのみ）。
- TypeScript/React部分に自動テストは追加しない（既存リポジトリの慣習どおり手動確認。`scripts/lib/*.mjs` の純関数部分のみ `node --test` で自動テスト）。

---

## ファイル一覧（新規・変更）

| ファイル | 種別 | 役割 |
|---|---|---|
| `config/tag-synonyms.json` | 新規 | 同義語グループのシードデータ |
| `scripts/lib/synonyms.mjs` | 新規 | `expandTerm`・`loadSynonymGroups` |
| `scripts/lib/synonyms.test.mjs` | 新規 | 上記のテスト |
| `scripts/lib/filter.mjs` | 変更 | `freeTags`条件追加、`place`/`subjects`を配列化、同義語展開対応 |
| `scripts/lib/filter.test.mjs` | 変更（全面書き換え） | 新契約に合わせたテスト |
| `lib/shared-labels.ts` | 新規 | `SharedLabel`型、`readLeafLabels(leafIds)`（Redis個別GET） |
| `app/api/tag-vocab/route.ts` | 新規 | `GET`: フォルダ内の語彙一覧（件数付き・同義語統合済み） |
| `app/api/tag-search/route.ts` | 新規 | `POST`: 条件に合う`fileId`一覧を返す |
| `app/components/TagSearchPanel.tsx` | 新規 | フィルタUI＋`ImageGrid`呼び出し |
| `app/page.tsx` | 変更 | `tagsearch`タブの追加 |

---

### Task 1: 同義語シードデータの作成

**Files:**
- Create: `config/tag-synonyms.json`

**Interfaces:**
- Produces: JSON配列 `{ canonical: string; synonyms: string[] }[]`。Task 2以降がこのファイルを読み込む。

- [ ] **Step 1: ファイルを作成する**

`config/tag-synonyms.json`:
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

- [ ] **Step 2: JSONとして正しくパースできることを確認する**

Run: `node -e 'const g=JSON.parse(require("fs").readFileSync("config/tag-synonyms.json","utf8")); console.log("groups:", g.length, "ok:", g.every(x=>typeof x.canonical==="string"&&Array.isArray(x.synonyms)));'`

Expected: `groups: 17 ok: true`

- [ ] **Step 3: コミット**

```bash
git add config/tag-synonyms.json
git commit -m "feat: add initial tag synonym seed data"
```

---

### Task 2: `scripts/lib/synonyms.mjs`（TDD）

**Files:**
- Create: `scripts/lib/synonyms.test.mjs`
- Create: `scripts/lib/synonyms.mjs`

**Interfaces:**
- Consumes: Task 1の `config/tag-synonyms.json`（`loadSynonymGroups`のデフォルト読み込み先）。
- Produces:
  - `expandTerm(term: string, groups: {canonical:string;synonyms?:string[]}[] = []): string[]`
  - `loadSynonymGroups(path?: string): {canonical:string;synonyms:string[]}[]`
  Task 3（`filter.mjs`）と Task 5/6（APIルート）がこれをimportする。

- [ ] **Step 1: 失敗するテストを書く**

`scripts/lib/synonyms.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandTerm, loadSynonymGroups } from "./synonyms.mjs";

const groups = [
  { canonical: "バルコニー", synonyms: ["ベランダ"] },
  { canonical: "洗面室", synonyms: ["洗面所"] },
];

test("expandTerm はグループ内の別表記から代表表記を含めて展開する", () => {
  const r = expandTerm("ベランダ", groups);
  assert.deepEqual(new Set(r), new Set(["ベランダ", "バルコニー"]));
});

test("expandTerm は代表表記からも同じグループを展開できる", () => {
  const r = expandTerm("バルコニー", groups);
  assert.deepEqual(new Set(r), new Set(["ベランダ", "バルコニー"]));
});

test("expandTerm はグループ外の語をそのまま1件だけ返す", () => {
  assert.deepEqual(expandTerm("リビング", groups), ["リビング"]);
});

test("expandTerm は空文字に空配列を返す", () => {
  assert.deepEqual(expandTerm("", groups), []);
});

test("expandTerm はgroups省略時グループ外扱いでそのまま返す", () => {
  assert.deepEqual(expandTerm("バルコニー"), ["バルコニー"]);
});

test("loadSynonymGroups は存在しないパスで空配列を返す（壊れない）", () => {
  assert.deepEqual(loadSynonymGroups("/nonexistent/path.json"), []);
});

test("loadSynonymGroups は実際の設定ファイルを読み込める", () => {
  const g = loadSynonymGroups();
  assert.ok(Array.isArray(g));
  assert.ok(g.length > 0);
  assert.ok(g.every((x) => typeof x.canonical === "string" && Array.isArray(x.synonyms)));
});
```

- [ ] **Step 2: テストを実行し、失敗することを確認する**

Run: `node --test scripts/lib/synonyms.test.mjs`
Expected: FAIL（`Cannot find module './synonyms.mjs'`）

- [ ] **Step 3: 実装する**

`scripts/lib/synonyms.mjs`:
```js
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function expandTerm(term, groups = []) {
  if (!term) return [];
  const results = new Set([term]);
  for (const group of groups) {
    const members = [group.canonical, ...(group.synonyms ?? [])];
    if (members.includes(term)) {
      for (const m of members) results.add(m);
    }
  }
  return [...results];
}

export function loadSynonymGroups(path = join(process.cwd(), "config", "tag-synonyms.json")) {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: テストを実行し、成功することを確認する**

Run: `node --test scripts/lib/synonyms.test.mjs` （リポジトリルートから実行すること。`loadSynonymGroups`のデフォルトパスが`process.cwd()`基準のため）
Expected: `pass 7`（全テスト成功）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/synonyms.mjs scripts/lib/synonyms.test.mjs
git commit -m "feat: add synonym expansion helper for tag search"
```

---

### Task 3: `scripts/lib/filter.mjs` の拡張（TDD）

**Files:**
- Modify: `scripts/lib/filter.test.mjs`（全面書き換え）
- Modify: `scripts/lib/filter.mjs`

**Interfaces:**
- Consumes: Task 2の `expandTerm(term, groups)`。
- Produces: `filterByCriteria(items: {folderId:string;fileId:string;label:object}[], criteria: {scene?:string;hasPerson?:string;shot?:string;place?:string[];subjects?:string[];freeTags?:string[]}, synonymGroups?: object[]): items[]`
  Task 6（`/api/tag-search`ルート）がこれをimportする。**契約変更に注意**: 従来の `criteria.place`（単一文字列）・`criteria.subject`（単一文字列）から、`criteria.place`（配列）・`criteria.subjects`（配列、`subject`から改名）に変わる。`filterByCriteria`は他ファイルから未使用（自身のテスト以外に依存箇所なし、確認済み）のため後方互換は不要。

- [ ] **Step 1: 新しい契約に合わせてテストを全面書き換える**

`scripts/lib/filter.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterByCriteria } from "./filter.mjs";

const items = [
  { folderId: "f1", fileId: "i1", label: { scene: "屋内", place: "リビング", subjects: ["ソファ"], freeTags: ["明るい"] } },
  { folderId: "f1", fileId: "i2", label: { scene: "屋外", place: "外観", subjects: ["庭"], freeTags: [] } },
  { folderId: "f2", fileId: "i3", label: { scene: "屋内", place: "和室", subjects: ["畳", "窓"], freeTags: ["ナチュラル"] } },
  { folderId: "f2", fileId: "i4", label: { scene: "屋内", place: "リビング", subjects: ["バルコニー"], freeTags: [] } },
];

test("scene と place(配列・部分一致) で絞る", () => {
  const r = filterByCriteria(items, { scene: "屋内", place: ["リビング"] });
  assert.deepEqual(r.map((x) => x.fileId), ["i1", "i4"]);
});

test("subjects は軸内OR（配列のいずれかに部分一致すればヒット）", () => {
  const r = filterByCriteria(items, { subjects: ["窓", "ソファ"] });
  assert.deepEqual(r.map((x) => x.fileId), ["i1", "i3"]);
});

test("freeTags 条件に対応する", () => {
  const r = filterByCriteria(items, { freeTags: ["ナチュラル"] });
  assert.deepEqual(r.map((x) => x.fileId), ["i3"]);
});

test("空 criteria は全通過", () => {
  assert.equal(filterByCriteria(items, {}).length, 4);
});

test("同義語グループを渡すと展開して照合する（軸間ANDも維持される）", () => {
  const groups = [{ canonical: "バルコニー", synonyms: ["ベランダ"] }];
  const r = filterByCriteria(items, { subjects: ["ベランダ"] }, groups);
  assert.deepEqual(r.map((x) => x.fileId), ["i4"]);
});

test("同義語グループ未指定なら別表記は素通りしない", () => {
  const r = filterByCriteria(items, { subjects: ["ベランダ"] });
  assert.deepEqual(r.map((x) => x.fileId), []);
});
```

- [ ] **Step 2: テストを実行し、失敗することを確認する**

Run: `node --test scripts/lib/filter.test.mjs`
Expected: FAIL（`place`が配列になったことで既存実装の`.includes(c.place)`が配列同士の比較になり不一致、`subjects`/`freeTags`は未対応のため）

- [ ] **Step 3: 実装を書き換える**

`scripts/lib/filter.mjs`:
```js
import { expandTerm } from "./synonyms.mjs";

function matchesAnyTerm(values, terms, groups) {
  return terms.some((term) =>
    expandTerm(term, groups).some((variant) => values.some((value) => value.includes(variant)))
  );
}

export function filterByCriteria(items, criteria = {}, synonymGroups = []) {
  const c = criteria;
  return items.filter(({ label = {} }) => {
    if (c.scene && label.scene !== c.scene) return false;
    if (c.hasPerson && label.hasPerson !== c.hasPerson) return false;
    if (c.shot && label.shot !== c.shot) return false;
    if (c.place?.length && !matchesAnyTerm([label.place ?? ""], c.place, synonymGroups)) return false;
    if (c.subjects?.length && !matchesAnyTerm(label.subjects ?? [], c.subjects, synonymGroups)) return false;
    if (c.freeTags?.length && !matchesAnyTerm(label.freeTags ?? [], c.freeTags, synonymGroups)) return false;
    return true;
  });
}
```

- [ ] **Step 4: テストを実行し、成功することを確認する**

Run: `node --test scripts/lib/filter.test.mjs`
Expected: `pass 6`

- [ ] **Step 5: 全体のテストスイートも通ることを確認する**

Run: `node --test scripts/lib/*.test.mjs`
Expected: 既存の32件＋今回追加分すべて `pass`、`fail 0`

- [ ] **Step 6: コミット**

```bash
git add scripts/lib/filter.mjs scripts/lib/filter.test.mjs
git commit -m "feat: extend filterByCriteria with freeTags and synonym-aware matching"
```

---

### Task 4: `lib/shared-labels.ts`（Redis個別GETヘルパー）

**Files:**
- Create: `lib/shared-labels.ts`

**Interfaces:**
- Consumes: なし（`@upstash/redis`と環境変数 `KV_REST_API_URL`/`KV_REST_API_TOKEN` のみ。既存 `app/api/colors/route.ts` と同じ環境変数）。
- Produces:
  - `type SharedLabel = { hasPerson?: "人物あり"|"人物なし"; scene?: "屋内"|"屋外"; shot?: "寄り"|"引き"; place?: string; subjects?: string[]; freeTags?: string[]; }`
  - `type SharedLabelItem = { folderId: string; fileId: string; label: SharedLabel }`
  - `readLeafLabels(leafIds: string[]): Promise<SharedLabelItem[]>`
  Task 5・6のAPIルートがこれをimportする。

このタスクはTS/Redis依存のため自動テストは書かない（リポジトリの既存慣習どおり）。Task 5で実際のAPIルートに組み込んだ際に手動確認する。

- [ ] **Step 1: ディレクトリを作成しファイルを実装する**

`lib/shared-labels.ts`:
```ts
import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const PREFIX = "labels:shared:";

export type SharedLabel = {
  hasPerson?: "人物あり" | "人物なし";
  scene?: "屋内" | "屋外";
  shot?: "寄り" | "引き";
  place?: string;
  subjects?: string[];
  freeTags?: string[];
};

export type SharedLabelItem = {
  folderId: string;
  fileId: string;
  label: SharedLabel;
};

export async function readLeafLabels(leafIds: string[]): Promise<SharedLabelItem[]> {
  const items: SharedLabelItem[] = [];
  const results = await Promise.all(
    leafIds.map((leafId) => kv.get<Record<string, SharedLabel>>(`${PREFIX}${leafId}`))
  );
  leafIds.forEach((leafId, i) => {
    const map = results[i] || {};
    for (const [fileId, label] of Object.entries(map)) {
      items.push({ folderId: leafId, fileId, label });
    }
  });
  return items;
}
```

- [ ] **Step 2: TypeScriptの型チェックが通ることを確認する**

Run: `npx tsc --noEmit`
Expected: エラーなし（既存の`tsconfig.tsbuildinfo`由来の無関係な警告が出ないこと。出力が空であれば成功）

- [ ] **Step 3: コミット**

```bash
git add lib/shared-labels.ts
git commit -m "feat: add readLeafLabels helper for scoped shared-label reads"
```

---

### Task 5: `GET /api/tag-vocab` ルート

**Files:**
- Create: `app/api/tag-vocab/route.ts`

**Interfaces:**
- Consumes:
  - Task 4: `readLeafLabels(leafIds: string[]): Promise<SharedLabelItem[]>`
  - Task 2: `loadSynonymGroups(): {canonical:string;synonyms:string[]}[]`
  - 既存 `scripts/lib/vocab.mjs`: `collectVocab(items, field): Map<string, number>`
- Produces: `GET /api/tag-vocab?leafIds=<id1,id2,...>` → `{ place: {value:string;count:number}[], subjects: [...], freeTags: [...] }`（件数降順）。Task 7の`TagSearchPanel`がこれをfetchする。

- [ ] **Step 1: ルートを実装する**

`app/api/tag-vocab/route.ts`:
```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { readLeafLabels } from "@/lib/shared-labels";
import { collectVocab } from "@/scripts/lib/vocab.mjs";
import { loadSynonymGroups } from "@/scripts/lib/synonyms.mjs";

type Group = { canonical: string; synonyms?: string[] };

function mergeSynonymCounts(counts: Map<string, number>, groups: Group[]) {
  const merged = new Map<string, number>();
  for (const [value, count] of counts) {
    const group = groups.find((g) => [g.canonical, ...(g.synonyms ?? [])].includes(value));
    const key = group ? group.canonical : value;
    merged.set(key, (merged.get(key) ?? 0) + count);
  }
  return merged;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const leafIdsParam = searchParams.get("leafIds");
  if (!leafIdsParam) {
    return NextResponse.json({ error: "leafIds が必要です" }, { status: 400 });
  }
  const leafIds = leafIdsParam.split(",").filter(Boolean);

  const items = await readLeafLabels(leafIds);
  const groups = loadSynonymGroups();

  const toSorted = (field: "place" | "subjects" | "freeTags") => {
    const counts = mergeSynonymCounts(collectVocab(items, field), groups);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  };

  return NextResponse.json({
    place: toSorted("place"),
    subjects: toSorted("subjects"),
    freeTags: toSorted("freeTags"),
  });
}
```

- [ ] **Step 2: 開発サーバーを起動する**

Run: `npm run dev`（ポート3000で起動するまで待つ）

- [ ] **Step 3: ブラウザでログインし、DevToolsコンソールで動作確認する**

1. `http://localhost:3000` を開き、Googleログインを済ませる。
2. 既にタグ付け済みのリーフフォルダID `1YwNlYLYViw57Y78AlutN3CRNMCNoG_YC`（「9回目-高砂ガーデンスクエア」、40件タグ付け済み）を使い、DevToolsコンソールで以下を実行:
```js
fetch('/api/tag-vocab?leafIds=1YwNlYLYViw57Y78AlutN3CRNMCNoG_YC').then(r=>r.json()).then(console.log)
```

Expected: `place`に`{value:"建物外観",count:...}`や`{value:"リビング",count:...}`等が件数付きで含まれ、`subjects`/`freeTags`も同様に返る（0件配列にはならない）。

- [ ] **Step 4: コミット**

```bash
git add app/api/tag-vocab/route.ts
git commit -m "feat: add GET /api/tag-vocab for folder-scoped tag vocabulary"
```

---

### Task 6: `POST /api/tag-search` ルート

**Files:**
- Create: `app/api/tag-search/route.ts`

**Interfaces:**
- Consumes:
  - Task 4: `readLeafLabels(leafIds: string[]): Promise<SharedLabelItem[]>`
  - Task 2: `loadSynonymGroups()`
  - Task 3: `filterByCriteria(items, criteria, synonymGroups)`
- Produces: `POST /api/tag-search` body `{leafIds:string[]; criteria?:{scene?,hasPerson?,shot?,place?:string[],subjects?:string[],freeTags?:string[]}}` → `{ fileIds: string[] }`。Task 7の`TagSearchPanel`がこれをfetchする。

- [ ] **Step 1: ルートを実装する**

`app/api/tag-search/route.ts`:
```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { readLeafLabels } from "@/lib/shared-labels";
import { filterByCriteria } from "@/scripts/lib/filter.mjs";
import { loadSynonymGroups } from "@/scripts/lib/synonyms.mjs";

type SearchCriteria = {
  scene?: "屋内" | "屋外";
  hasPerson?: "人物あり" | "人物なし";
  shot?: "寄り" | "引き";
  place?: string[];
  subjects?: string[];
  freeTags?: string[];
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  let body: { leafIds?: string[]; criteria?: SearchCriteria };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }
  const { leafIds, criteria } = body;
  if (!leafIds || !Array.isArray(leafIds) || leafIds.length === 0) {
    return NextResponse.json({ error: "leafIds が必要です" }, { status: 400 });
  }

  const items = await readLeafLabels(leafIds);
  const groups = loadSynonymGroups();
  const matched = filterByCriteria(items, criteria ?? {}, groups);

  return NextResponse.json({ fileIds: matched.map((x) => x.fileId) });
}
```

- [ ] **Step 2: 開発サーバーが起動していることを確認する（Task 5から継続、なければ`npm run dev`）**

- [ ] **Step 3: ブラウザでログイン済みの状態で、DevToolsコンソールで動作確認する**

```js
fetch('/api/tag-search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    leafIds: ['1YwNlYLYViw57Y78AlutN3CRNMCNoG_YC'],
    criteria: { scene: '屋外' }
  })
}).then(r=>r.json()).then(console.log)
```

Expected: `{ fileIds: [...] }` に、そのリーフ内で `scene: "屋外"` としてタグ付けされている `fileId` のみが含まれる（`屋内`のものは含まれない）。

- [ ] **Step 4: 同義語展開の動作も確認する**

```js
fetch('/api/tag-search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    leafIds: ['1YwNlYLYViw57Y78AlutN3CRNMCNoG_YC'],
    criteria: { subjects: ['ベランダ'] }
  })
}).then(r=>r.json()).then(console.log)
```

Expected: 「バルコニー」でタグ付けされた画像があれば、そのfileIdが `fileIds` に含まれる（「ベランダ」という文字列そのものはタグに存在しないが同義語展開でヒットする）。

- [ ] **Step 5: コミット**

```bash
git add app/api/tag-search/route.ts
git commit -m "feat: add POST /api/tag-search for structured tag filtering"
```

---

### Task 7: `TagSearchPanel.tsx`

**Files:**
- Create: `app/components/TagSearchPanel.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/tag-vocab?leafIds=...` → `{place,subjects,freeTags: {value,count}[]}`（Task 5）
  - `POST /api/tag-search` → `{fileIds: string[]}`（Task 6）
  - 既存 `app/components/ImageGrid.tsx` の `Props`（`folders`/`folderId`/`initialColors`/`initialMonths`/`initialMemos`/`initialFolderTagCount`/`initialFolderTags`/`initialRenameMap`/`userName`/`canUseColor`/`canEditMemo`/`canUseFolderTag`）
  - 既存 `app/api/drive/route.ts` の `DriveFolder`/`DriveImage` 型
- Produces: `export default function TagSearchPanel(props: Props): JSX.Element`。Task 8で`page.tsx`から呼ばれる。`Props`は`ImageGrid`と同一の受け取りキー（`folders`/`folderId`含む）。

- [ ] **Step 1: コンポーネントを実装する**

`app/components/TagSearchPanel.tsx`:
```tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import ImageGrid from "@/app/components/ImageGrid";
import type { DriveFolder } from "@/app/api/drive/route";

type MemoEntry = { text: string; authorName: string; updatedAt: string };

type VocabEntry = { value: string; count: number };
type VocabResponse = { place: VocabEntry[]; subjects: VocabEntry[]; freeTags: VocabEntry[] };

type Criteria = {
  scene?: "屋内" | "屋外";
  hasPerson?: "人物あり" | "人物なし";
  shot?: "寄り" | "引き";
  place: string[];
  subjects: string[];
  freeTags: string[];
};

type Props = {
  folders: DriveFolder[];
  folderId: string;
  initialColors: Record<string, string>;
  initialMonths: Record<string, string>;
  initialMemos: Record<string, MemoEntry>;
  initialFolderTagCount: number;
  initialFolderTags: Record<string, number>;
  initialRenameMap: Record<string, string>;
  userName: string;
  canUseColor?: boolean;
  canEditMemo?: boolean;
  canUseFolderTag?: boolean;
};

const EMPTY_CRITERIA: Criteria = { place: [], subjects: [], freeTags: [] };

function TagAutocomplete({
  label,
  options,
  selected,
  onAdd,
  onRemove,
}: {
  label: string;
  options: VocabEntry[];
  selected: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const suggestions = query
    ? options.filter((o) => o.value.includes(query) && !selected.includes(o.value)).slice(0, 8)
    : [];
  const quickTags = options.filter((o) => !selected.includes(o.value)).slice(0, 6);

  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-1 mb-1">
        {selected.map((v) => (
          <span key={v} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm flex items-center gap-1">
            {v}
            <button onClick={() => onRemove(v)} aria-label={`${v}を削除`}>×</button>
          </span>
        ))}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`${label}を検索`}
        className="border rounded px-2 py-1 text-sm w-full"
      />
      {suggestions.length > 0 && (
        <ul className="border rounded mt-1 bg-white shadow-sm">
          {suggestions.map((s) => (
            <li key={s.value}>
              <button
                onClick={() => { onAdd(s.value); setQuery(""); }}
                className="w-full text-left px-2 py-1 hover:bg-gray-100 text-sm"
              >
                {s.value} ({s.count})
              </button>
            </li>
          ))}
        </ul>
      )}
      {!query && quickTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {quickTags.map((t) => (
            <button
              key={t.value}
              onClick={() => onAdd(t.value)}
              className="px-2 py-0.5 border rounded text-xs text-gray-600"
            >
              {t.value} ({t.count})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TagSearchPanel({ folders, folderId, ...gridProps }: Props) {
  const leafIds = useMemo(() => folders.map((f) => f.id), [folders]);
  const [vocab, setVocab] = useState<VocabResponse | null>(null);
  const [criteria, setCriteria] = useState<Criteria>(EMPTY_CRITERIA);
  const [fileIds, setFileIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (leafIds.length === 0) return;
    fetch(`/api/tag-vocab?leafIds=${leafIds.join(",")}`)
      .then((res) => res.json())
      .then((data: VocabResponse) => setVocab(data))
      .catch(() => setError("語彙の取得に失敗しました"));
  }, [leafIds]);

  useEffect(() => {
    if (leafIds.length === 0) return;
    setLoading(true);
    setError(null);
    fetch("/api/tag-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leafIds, criteria }),
    })
      .then((res) => res.json())
      .then((data: { fileIds: string[] }) => setFileIds(data.fileIds))
      .catch(() => setError("検索に失敗しました"))
      .finally(() => setLoading(false));
  }, [leafIds, criteria]);

  const filteredFolders: DriveFolder[] = useMemo(() => {
    if (fileIds === null) return folders;
    const matchSet = new Set(fileIds);
    return folders
      .map((f) => ({ ...f, images: f.images.filter((img) => matchSet.has(img.id)) }))
      .filter((f) => f.images.length > 0);
  }, [folders, fileIds]);

  const toggle = (field: "scene" | "hasPerson" | "shot", value: string) => {
    setCriteria((prev) => ({ ...prev, [field]: prev[field] === value ? undefined : value }));
  };

  const addChip = (field: "place" | "subjects" | "freeTags", value: string) => {
    setCriteria((prev) =>
      prev[field].includes(value) ? prev : { ...prev, [field]: [...prev[field], value] }
    );
  };

  const removeChip = (field: "place" | "subjects" | "freeTags", value: string) => {
    setCriteria((prev) => ({ ...prev, [field]: prev[field].filter((v) => v !== value) }));
  };

  if (!folderId) {
    return <p className="text-gray-400 py-10 text-center">フォルダを選択してください</p>;
  }

  if (vocab && vocab.place.length === 0 && vocab.subjects.length === 0 && vocab.freeTags.length === 0) {
    return <p className="text-gray-400 py-10 text-center">このフォルダはまだタグ付けされていません</p>;
  }

  return (
    <div>
      {error && <p className="text-red-500 mb-2">{error}</p>}
      <div className="flex flex-wrap gap-2 mb-2">
        {(["屋内", "屋外"] as const).map((v) => (
          <button
            key={v}
            onClick={() => toggle("scene", v)}
            className={`px-3 py-1 rounded border ${criteria.scene === v ? "bg-blue-500 text-white" : "bg-white"}`}
          >
            {v}
          </button>
        ))}
        {(["人物あり", "人物なし"] as const).map((v) => (
          <button
            key={v}
            onClick={() => toggle("hasPerson", v)}
            className={`px-3 py-1 rounded border ${criteria.hasPerson === v ? "bg-blue-500 text-white" : "bg-white"}`}
          >
            {v}
          </button>
        ))}
        {(["寄り", "引き"] as const).map((v) => (
          <button
            key={v}
            onClick={() => toggle("shot", v)}
            className={`px-3 py-1 rounded border ${criteria.shot === v ? "bg-blue-500 text-white" : "bg-white"}`}
          >
            {v}
          </button>
        ))}
      </div>

      {(["place", "subjects", "freeTags"] as const).map((field) => (
        <TagAutocomplete
          key={field}
          label={field}
          options={vocab ? vocab[field] : []}
          selected={criteria[field]}
          onAdd={(v) => addChip(field, v)}
          onRemove={(v) => removeChip(field, v)}
        />
      ))}

      <p className="text-sm text-gray-500 my-2">
        {loading ? "検索中..." : `${filteredFolders.reduce((n, f) => n + f.images.length, 0)}件`}
      </p>

      <ImageGrid
        key={folderId}
        folders={filteredFolders}
        folderId={folderId}
        {...gridProps}
      />
    </div>
  );
}
```

- [ ] **Step 2: TypeScriptの型チェックが通ることを確認する**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add app/components/TagSearchPanel.tsx
git commit -m "feat: add TagSearchPanel component with autocomplete tag filters"
```

---

### Task 8: `page.tsx` へのタブ組み込み

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: Task 7の `TagSearchPanel`（`Props`は既存`ImageGrid`呼び出しと同じ値をそのまま渡せる）。

- [ ] **Step 1: importを追加する**

`app/page.tsx` の既存import群（`ThemeAnalysis`のimportの直後）に追加:
```tsx
import TagSearchPanel from "@/app/components/TagSearchPanel";
```

- [ ] **Step 2: `activeTab` の判定式を拡張する**

変更前:
```tsx
  const activeTab = params.tab === "theme" ? "theme" : "select";
```
変更後:
```tsx
  const activeTab = params.tab === "theme" ? "theme" : params.tab === "tagsearch" ? "tagsearch" : "select";
```

- [ ] **Step 3: タブナビに「タグ検索」リンクを追加する**

既存の「🏷️ テーマ分析」`<a>`タグの直後（`</div>`の直前）に追加:
```tsx
            <a
              href={`?folderId=${folderId}&tab=tagsearch`}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === "tagsearch"
                  ? "border-green-500 text-green-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              🔍 タグ検索
            </a>
```

- [ ] **Step 4: タグ検索タブの描画ブロックを追加する**

既存の「テーマ分析タブ」ブロックの直後に追加:
```tsx
        {/* タグ検索タブ */}
        {folders.length > 0 && activeTab === "tagsearch" && (
          <TagSearchPanel
            key={folderId}
            folders={folders}
            folderId={folderId}
            initialColors={colors}
            initialMonths={months}
            initialMemos={memos}
            initialFolderTagCount={folderTagCount}
            initialFolderTags={folderTags}
            initialRenameMap={renameMap}
            userName={session.user?.name || session.user?.email || ""}
            canUseColor={canUseColor}
            canEditMemo={canEditMemo}
            canUseFolderTag={canUseFolderTag}
          />
        )}
```

- [ ] **Step 5: TypeScriptの型チェックが通ることを確認する**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add app/page.tsx
git commit -m "feat: wire TagSearchPanel into a new tagsearch tab"
```

---

### Task 9: エンドツーエンド手動確認

**Files:** なし（動作確認のみ）

**Interfaces:** なし（最終確認タスク）

- [ ] **Step 1: Lintを通す**

Run: `npm run lint`
Expected: エラーなし（warningのみなら許容）

- [ ] **Step 2: 開発サーバーを起動する**

Run: `npm run dev`

- [ ] **Step 3: 実データのあるフォルダで一連の操作を確認する**

1. ブラウザでログインし、フォルダID `1YwNlYLYViw57Y78AlutN3CRNMCNoG_YC` を開く（タグ付け済み40枚）。
2. 「🔍 タグ検索」タブに切り替える。
3. `place`欄に「リビング」を入力し候補から選択 → 件数が絞り込まれ、`ImageGrid`の表示画像も絞り込み後の枚数になることを確認。
4. `subjects`欄に「ベランダ」と入力 → 候補に「バルコニー」（同義語展開）が出てくるか、または直接検索して「バルコニー」タグの画像がヒットすることを確認。
5. 絞り込んだ状態で、画像を1枚選択して色タグを付ける（`canUseColor`が有効な場合）→ 正常に動作することを確認（`ImageGrid`の既存機能がそのまま使えることの確認）。
6. すべてのフィルタ（scene/hasPerson/shot/place/subjects/freeTags）を解除し、絞り込み前の全画像数に戻ることを確認。

- [ ] **Step 4: 未タグ付けフォルダでの空状態を確認する**

タグ付けされていないフォルダID（またはリーフを持たない適当なフォルダ）で「🔍 タグ検索」タブを開き、「このフォルダはまだタグ付けされていません」の表示が出ることを確認する。

- [ ] **Step 5: 最終コミット（必要であれば）**

上記確認で問題が見つかった場合はここで修正し、コミットする。問題がなければこのタスクはコミット不要。

---

## 自己レビュー結果

- **スペック網羅性**: §3データモデル→Task1-4、§4アーキテクチャ→Task5-8、§5 API仕様→Task5-6、§6 filter.mjs拡張→Task3、§7 UI→Task7、§8エラー処理→Task7内(空状態・エラー表示)、§9テスト→Task2-3(自動)+Task9(手動)、§11完了条件→Task9で確認。すべて対応するタスクあり。
- **プレースホルダ**: なし（全ステップに実コードあり）。
- **型の一貫性**: `SharedLabel`（Task4）→ `readLeafLabels`の返り値 → Task5/6のAPIルート → Task7の`Criteria`/`VocabResponse`まで、キー名（`place`/`subjects`/`freeTags`/`scene`/`hasPerson`/`shot`）を一貫して使用。`filterByCriteria`の新契約（`place`/`subjects`が配列、`subject`→`subjects`に改名）はTask3で完結させ、Task6はその新契約のみを前提にしている。
