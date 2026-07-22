# Redisアクセスをアプリ経由に一本化（案C）実装計画 — issue #2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ローカルのタグ付け/収集スキルが Redis を直接叩く（全権 `KV_REST_API_TOKEN` をローカルに要求する）のをやめ、既存 Next.js アプリに専用トークン保護の `labels:shared` 用 API を1本足して、CLI はそれを HTTPS 経由で叩く形にする。全権 KV トークンはローカルから排除し、ローカルには用途限定の `LABELS_INGEST_TOKEN` のみ（macOS キーチェーン）を置く。

**Architecture:** サーバー側（Vercel 関数、既存の `KV_REST_API_TOKEN` を保持）に `GET/POST /api/labels-shared` を追加し、`Authorization: Bearer <LABELS_INGEST_TOKEN>` で保護。CLI 側（`scripts/lib/redis.mjs`）は Upstash 直叩きをやめ、キーチェーンから読んだ専用トークンで上記 API を fetch する。CLI の外部インターフェース（`readAllLabels()` / `writeLabels()`）は据え置き、tag-images の逐次・冪等書込はそのまま維持。

**Tech Stack:** Next.js 16.2.0 route handlers、`@upstash/redis`（サーバー側のみ）、Node 20 `fetch`、macOS `security`（キーチェーン）、`node --test`、ESM `.mjs`。

## Global Constraints

- **全権 `KV_REST_API_TOKEN` はローカルに一切置かない。** ローカルが持つのは用途限定の `LABELS_INGEST_TOKEN` のみ、macOS キーチェーン項目 `image-selector-labels-token` に格納。
- **トークンの値は生成・設置をユーザーが1回だけ行い、値は transcript にも出さない**（実装者はコードのみ作る。値に触れない）。
- サーバー API が触る Redis キーは **`labels:shared:*` のみ**（read は scan、write は該当フォルダのマージのみ）。他キー（bookmarks/colors/months/memos/folderTags/renameMap/themes/`labels:{email}:*`）には一切触れない。
- 新ルートは既存 `app/api/labels/route.ts`（`labels:{email}:{folderId}`・別スキーマ）と**衝突させない**。パスは `app/api/labels-shared/route.ts`。
- 認証は `Authorization: Bearer <token>` を `process.env.LABELS_INGEST_TOKEN` と**定数時間比較**（`crypto.timingSafeEqual`、長さ不一致は先に弾く）。トークン未設定サーバーは 503。不一致/欠落は 401。
- CLI の接続先は非秘密の env `LABELS_API_BASE`（例 `https://<deployment>.vercel.app`）。未設定なら明示エラー。
- Redis のカーソル完了判定は数値 `0`・文字列 `"0"` の両方を扱う（既存 `app/api/admin-backup/route.ts` のパターン。scripts 側は `keys.mjs` の `isScanComplete`）。
- 新規 npm 依存は追加しない。既存ルート（`app/api/labels/route.ts` 等）の書式に倣う。テストは `node --test`、`.mjs`。
- CLI はトークンを**ログ出力しない**（Authorization ヘッダにのみ使用）。

## File Structure

- Create: `scripts/lib/labels-api.mjs` — API リクエスト組み立て（純関数）: `buildReadRequest`, `buildWriteRequest`, `parseItemsResponse`。
- Create: `scripts/lib/labels-api.test.mjs`
- Create: `scripts/lib/api-config.mjs` — 接続設定取得: `getBaseUrl()`（env・純寄り）, `getToken()`（キーチェーン・IO）。
- Create: `scripts/lib/api-config.test.mjs` — `getBaseUrl` の検証のみ TDD。
- Modify: `scripts/lib/redis.mjs` — 内部を Upstash 直叩き→API fetch に差替。`readAllLabels()` / `writeLabels(folderId, incoming)` へ signature 変更。`makeClient` と `@upstash/redis` 参照を削除。`mergeLabels` は不要になるため削除。
- Modify: `scripts/lib/redis.test.mjs` — `mergeLabels` 削除に伴い、当該テストを削除（ファイルが空になるなら削除）。
- Modify: `scripts/read-labels.mjs` / `scripts/write-labels.mjs` / `scripts/vocab-report.mjs` — `makeClient()` 廃止に合わせて呼び出しを更新。
- Create: `app/api/labels-shared/route.ts` — `GET`（全 `labels:shared:*` 読取）/ `POST`（フォルダ単位マージ書込）、Bearer 認証。
- Modify: `.claude/skills/tag-images/SKILL.md` / `normalize-vocab/SKILL.md` / `collect-by-theme/SKILL.md` — 前提を「キーチェーン＋API」に更新。
- Modify: `scripts/README.md` — env 方針を「全権KVトークンは置かない／`LABELS_INGEST_TOKEN`（キーチェーン）＋`LABELS_API_BASE`（env）」に更新。ワンタイム設置手順を追記。

## Task 1: CLI リクエスト組み立て（labels-api.mjs, 純関数）

**Files:**
- Create: `scripts/lib/labels-api.mjs`
- Test: `scripts/lib/labels-api.test.mjs`

**Interfaces:**
- Produces:
  - `buildReadRequest(baseUrl, token)` → `{ url, options }`。url は `${baseUrl}/api/labels-shared`、options は `{ method: "GET", headers: { Authorization: "Bearer <token>" } }`。
  - `buildWriteRequest(baseUrl, token, folderId, labels)` → `{ url, options }`。options は `{ method: "POST", headers: { Authorization, "Content-Type": "application/json" }, body: JSON.stringify({ folderId, labels }) }`。
  - `parseItemsResponse(json)` → `json.items ?? []`（配列でなければ例外）。

- [ ] **Step 1: 失敗するテストを書く**

```js
// scripts/lib/labels-api.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReadRequest, buildWriteRequest, parseItemsResponse } from "./labels-api.mjs";

test("buildReadRequest は GET と Bearer を組む", () => {
  const { url, options } = buildReadRequest("https://x.example", "TKN");
  assert.equal(url, "https://x.example/api/labels-shared");
  assert.equal(options.method, "GET");
  assert.equal(options.headers.Authorization, "Bearer TKN");
});

test("buildReadRequest は baseUrl 末尾スラッシュを正規化", () => {
  const { url } = buildReadRequest("https://x.example/", "TKN");
  assert.equal(url, "https://x.example/api/labels-shared");
});

test("buildWriteRequest は POST・JSON body を組む", () => {
  const labels = { i1: { scene: "屋内" } };
  const { url, options } = buildWriteRequest("https://x.example", "TKN", "F1", labels);
  assert.equal(url, "https://x.example/api/labels-shared");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer TKN");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), { folderId: "F1", labels });
});

test("parseItemsResponse は items 配列を返す／不正は例外", () => {
  assert.deepEqual(parseItemsResponse({ items: [{ folderId: "F", fileId: "i", label: {} }] }),
    [{ folderId: "F", fileId: "i", label: {} }]);
  assert.deepEqual(parseItemsResponse({}), []);
  assert.throws(() => parseItemsResponse({ items: "nope" }));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/labels-api.test.mjs`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/labels-api.mjs
const PATH = "/api/labels-shared";
const normalize = (baseUrl) => baseUrl.replace(/\/+$/, "");

export function buildReadRequest(baseUrl, token) {
  return {
    url: `${normalize(baseUrl)}${PATH}`,
    options: { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  };
}

export function buildWriteRequest(baseUrl, token, folderId, labels) {
  return {
    url: `${normalize(baseUrl)}${PATH}`,
    options: {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, labels }),
    },
  };
}

export function parseItemsResponse(json) {
  const items = json?.items ?? [];
  if (!Array.isArray(items)) throw new Error("items が配列ではありません");
  return items;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/labels-api.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/labels-api.mjs scripts/lib/labels-api.test.mjs
git commit -m "feat: add labels-shared API request builders (pure)"
```

## Task 2: 接続設定の取得（api-config.mjs）

**Files:**
- Create: `scripts/lib/api-config.mjs`
- Test: `scripts/lib/api-config.test.mjs`

**Interfaces:**
- Produces:
  - `getBaseUrl(env = process.env)` → `env.LABELS_API_BASE`。未設定・非 http(s) は例外（テスト対象）。
  - `getToken()` → キーチェーン項目 `image-selector-labels-token` の値を `security find-generic-password -s image-selector-labels-token -w` で取得（末尾改行を trim）。IO のため手動検証。トークンはログしない。

- [ ] **Step 1: 失敗するテストを書く（getBaseUrl のみ）**

```js
// scripts/lib/api-config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { getBaseUrl } from "./api-config.mjs";

test("getBaseUrl は env から取得", () => {
  assert.equal(getBaseUrl({ LABELS_API_BASE: "https://x.example" }), "https://x.example");
});
test("未設定は例外", () => {
  assert.throws(() => getBaseUrl({}), /LABELS_API_BASE/);
});
test("http(s) でないURLは例外", () => {
  assert.throws(() => getBaseUrl({ LABELS_API_BASE: "ftp://x" }), /http/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test scripts/lib/api-config.test.mjs`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

```js
// scripts/lib/api-config.mjs
import { execFileSync } from "node:child_process";

const KEYCHAIN_SERVICE = "image-selector-labels-token";

export function getBaseUrl(env = process.env) {
  const base = env.LABELS_API_BASE;
  if (!base) throw new Error("LABELS_API_BASE（アプリのURL）が未設定です");
  if (!/^https?:\/\//.test(base)) throw new Error("LABELS_API_BASE は http(s) URL である必要があります");
  return base;
}

// キーチェーンから専用トークンを取得。値はログしない。
export function getToken() {
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
    });
    return out.replace(/\n$/, "");
  } catch {
    throw new Error(
      `キーチェーンに ${KEYCHAIN_SERVICE} が見つかりません。セットアップ手順（scripts/README.md）を実行してください`
    );
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test scripts/lib/api-config.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/api-config.mjs scripts/lib/api-config.test.mjs
git commit -m "feat: add api-config (base url + keychain token loader)"
```

## Task 3: サーバー API ルート `app/api/labels-shared/route.ts`

**Files:**
- Create: `app/api/labels-shared/route.ts`

**Interfaces:**
- `GET /api/labels-shared` （Bearer 必須）→ `{ items: [{ folderId, fileId, label }] }`。
- `POST /api/labels-shared` （Bearer 必須, body `{ folderId, labels }`）→ `{ ok: true, count }`。マージ書込。

**Note（実装者向け）:** 既存 `app/api/labels/route.ts` / `app/api/admin-backup/route.ts` の書式に倣う。
Redis クライアントは `new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! })`。
scan は admin-backup と同じく `while (cursor !== 0 && cursor !== "0")` でガード。

- [ ] **Step 1: ルートを作成**

```ts
// app/api/labels-shared/route.ts
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const SCAN_MATCH = "labels:shared:*";
const PREFIX = "labels:shared:";

// 定数時間比較。長さ不一致は先に false。
function tokenOk(header: string | null): boolean {
  const expected = process.env.LABELS_INGEST_TOKEN;
  if (!expected) return false; // サーバー未設定
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authError(): NextResponse | null {
  if (!process.env.LABELS_INGEST_TOKEN) {
    return NextResponse.json({ error: "サーバー未設定（LABELS_INGEST_TOKEN）" }, { status: 503 });
  }
  return null;
}

export async function GET(request: Request) {
  const misconfig = authError();
  if (misconfig) return misconfig;
  if (!tokenOk(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items: { folderId: string; fileId: string; label: unknown }[] = [];
  let cursor: string | number = 0;
  do {
    const [next, keys] = await kv.scan(cursor, { match: SCAN_MATCH, count: 100 });
    cursor = next;
    for (const key of keys) {
      const folderId = key.slice(PREFIX.length);
      const map = (await kv.get<Record<string, unknown>>(key)) || {};
      for (const [fileId, label] of Object.entries(map)) items.push({ folderId, fileId, label });
    }
  } while (cursor !== 0 && cursor !== "0");

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const misconfig = authError();
  if (misconfig) return misconfig;
  if (!tokenOk(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { folderId, labels } = (await request.json()) as {
    folderId?: string;
    labels?: Record<string, unknown>;
  };
  if (!folderId || !labels || typeof labels !== "object") {
    return NextResponse.json({ error: "folderId・labels が必要です" }, { status: 400 });
  }

  const key = `${PREFIX}${folderId}`;
  const existing = (await kv.get<Record<string, unknown>>(key)) || {};
  const merged = { ...existing, ...labels };
  await kv.set(key, merged);

  return NextResponse.json({ ok: true, count: Object.keys(labels).length });
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit 2>&1 | grep -i "labels-shared" || echo "no type errors in labels-shared"`
Expected: `no type errors in labels-shared`（新ファイルに型エラーが無い）

- [ ] **Step 3: lint**

Run: `npx eslint app/api/labels-shared/route.ts`
Expected: エラーなし（exit 0）

- [ ] **Step 4: コミット**

```bash
git add app/api/labels-shared/route.ts
git commit -m "feat: add token-protected labels-shared relay API (GET/POST)"
```

## Task 4: CLI 側を API 経由に差替（redis.mjs ＋ 3 CLI）

**Files:**
- Modify: `scripts/lib/redis.mjs`
- Modify: `scripts/lib/redis.test.mjs`
- Modify: `scripts/read-labels.mjs`, `scripts/write-labels.mjs`, `scripts/vocab-report.mjs`

**Interfaces:**
- Produces（新）: `async readAllLabels()` → `[{folderId,fileId,label}]`（API GET）。`async writeLabels(folderId, incoming)` → void（API POST）。
- Consumes: `labels-api.mjs`, `api-config.mjs`。
- 削除: `makeClient`, `mergeLabels`, `@upstash/redis` import。

- [ ] **Step 1: redis.mjs を書き換え**

```js
// scripts/lib/redis.mjs
import { getBaseUrl, getToken } from "./api-config.mjs";
import { buildReadRequest, buildWriteRequest, parseItemsResponse } from "./labels-api.mjs";

// labels:shared:* を全取得（アプリの relay API 経由）。全権 KV トークンはローカルに持たない。
export async function readAllLabels() {
  const { url, options } = buildReadRequest(getBaseUrl(), getToken());
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`読取API失敗: ${res.status} ${await res.text()}`);
  return parseItemsResponse(await res.json());
}

// フォルダ単位でマージ書込（サーバー側でマージ）。
export async function writeLabels(folderId, incoming) {
  const { url, options } = buildWriteRequest(getBaseUrl(), getToken(), folderId, incoming);
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`書込API失敗: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 2: redis.test.mjs を更新**

`mergeLabels` は削除したので、そのテストを除去する。`scripts/lib/redis.test.mjs` の内容を以下に置き換える（ネットワーク依存のない範囲でモジュールが読み込めることだけ確認）：

```js
// scripts/lib/redis.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "./redis.mjs";

test("readAllLabels / writeLabels がエクスポートされている", () => {
  assert.equal(typeof store.readAllLabels, "function");
  assert.equal(typeof store.writeLabels, "function");
});
```

- [ ] **Step 3: 3つの CLI を更新**

```js
// scripts/read-labels.mjs
import { readAllLabels } from "./lib/redis.mjs";
const items = await readAllLabels();
process.stdout.write(JSON.stringify(items, null, 2));
```

```js
// scripts/write-labels.mjs
// usage: node scripts/write-labels.mjs <folderId>  (stdin に {fileId: label} JSON)
import { writeLabels } from "./lib/redis.mjs";
const folderId = process.argv[2];
if (!folderId) { console.error("folderId が必要です"); process.exit(1); }
let input = "";
for await (const chunk of process.stdin) input += chunk;
const incoming = JSON.parse(input);
await writeLabels(folderId, incoming);
console.log(`OK: ${Object.keys(incoming).length} 件を labels:shared:${folderId} に書込`);
```

```js
// scripts/vocab-report.mjs
// usage: node scripts/vocab-report.mjs <field>   field: place|subjects|freeTags
import { readAllLabels } from "./lib/redis.mjs";
import { collectVocab } from "./lib/vocab.mjs";
const field = process.argv[2] || "place";
const items = await readAllLabels();
const v = collectVocab(items, field);
const sorted = [...v.entries()].sort((a, b) => b[1] - a[1]);
process.stdout.write(JSON.stringify(sorted, null, 2));
```

- [ ] **Step 4: 純ロジックのテストが引き続き通ることを確認**

Run: `node --test scripts/lib/*.test.mjs`
Expected: 全 PASS（labels-api / api-config / redis〈export確認〉含む。件数は増減してよい）

- [ ] **Step 5: 構文チェック（CLI）**

Run: `for f in read-labels write-labels vocab-report; do node --check scripts/$f.mjs && echo "$f ok"; done`
Expected: 3つとも ok

- [ ] **Step 6: コミット**

```bash
git add scripts/lib/redis.mjs scripts/lib/redis.test.mjs scripts/read-labels.mjs scripts/write-labels.mjs scripts/vocab-report.mjs
git commit -m "refactor: route CLI label access through relay API (drop local KV token)"
```

## Task 5: スキルと README を新方式に更新

**Files:**
- Modify: `.claude/skills/tag-images/SKILL.md`, `.claude/skills/normalize-vocab/SKILL.md`, `.claude/skills/collect-by-theme/SKILL.md`
- Modify: `scripts/README.md`

- [ ] **Step 1: 各 SKILL.md の前提を更新**

3つの SKILL.md の「前提 / env」記述を、以下の趣旨に置き換える（各ファイルの該当箇所のみ編集）：
- Redis へは**直接アクセスしない**。`scripts/read-labels.mjs` / `write-labels.mjs` は**アプリの relay API 経由**で読み書きする。
- 必要な設定は **`LABELS_API_BASE`（env・アプリURL・非秘密）** と、**キーチェーン項目 `image-selector-labels-token`（用途限定トークン）**。全権 KV トークンはローカルに置かない。

- [ ] **Step 2: scripts/README.md の環境変数セクションを差し替え**

「## 環境変数」節を、次の内容に更新する：
- ローカルには**全権 KV トークンを置かない**。CLI はアプリの relay API（`/api/labels-shared`）を叩く。
- **`LABELS_API_BASE`**（env, 非秘密）: デプロイ済みアプリの URL（例 `https://<deployment>.vercel.app`）。
- **`LABELS_INGEST_TOKEN`**（キーチェーン `image-selector-labels-token`）: この用途専用トークン。**値はユーザーだけが知る**。
- **ワンタイム設置手順（値を画面に出さない）** を明記：

```bash
# 1. 専用トークンを生成し、Vercel とキーチェーンに設置（値は表示しない）
TOKEN=$(openssl rand -hex 32)
printf '%s' "$TOKEN" | vercel env add LABELS_INGEST_TOKEN production
security add-generic-password -a "$USER" -s image-selector-labels-token -w "$TOKEN" -U
unset TOKEN
# 2. アプリURL（非秘密）を設定
export LABELS_API_BASE="https://<あなたの本番URL>"
# 3. Vercel を再デプロイして LABELS_INGEST_TOKEN を反映（git push で自動 or `vercel --prod`）
```

- Google OAuth（Path 2）の記述はそのまま残す（Drive アクセス用で別軸）。
- 「本番前チェック」節の (a) を、relay API 往復（write→read）を叩く手順に更新。

- [ ] **Step 3: コミット**

```bash
git add .claude/skills/tag-images/SKILL.md .claude/skills/normalize-vocab/SKILL.md .claude/skills/collect-by-theme/SKILL.md scripts/README.md
git commit -m "docs: update skills/README for relay-API label access (no local KV token)"
```

## Task 6: 全体テストと最終確認

- [ ] **Step 1: 全ユニットテスト**

Run: `node --test scripts/lib/*.test.mjs`
Expected: 全 PASS。

- [ ] **Step 2: 型チェック（全体、既存のエラーが増えていないこと）**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: 新規 `app/api/labels-shared/route.ts` 由来の型エラーが無い。

- [ ] **Step 3: 旧 env 記述が残っていないか grep**

Run: `grep -rn "KV_REST_API_TOKEN" scripts/ .claude/skills/ || echo "ローカル側にKVトークン参照なし=OK"`
Expected: `scripts/` と `.claude/skills/` に `KV_REST_API_TOKEN` 参照が無い（サーバー `app/` 側にのみ残る）。

- [ ] **Step 4: 進捗記録（コミット不要）**

`.superpowers/sdd/progress.md`（git-ignored）に最終状態を記録。

## Self-Review 結果（issue #2 との対応）

- 案C「専用トークン保護の relay API ＋ CLIは fetch」→ Task 3（API）＋ Task 4（CLI差替）。
- 「全権 KV トークンをローカルから排除」→ Task 4（`@upstash/redis`・`KV_REST_API_TOKEN` 参照を scripts から削除）＋ Task 6 Step 3（grep 検証）。
- 「用途限定トークンをキーチェーン」→ Task 2（`getToken`）＋ Task 5（設置手順）。
- 「CLI インターフェース不変・逐次冪等維持」→ Task 4（`readAllLabels`/`writeLabels` 名は維持、書込はフォルダ単位）。
- 「既存 /api/labels と非衝突」→ Task 3（`/api/labels-shared` 新設）。
- 「値を私も知らない」→ Task 5 の設置手順は値を echo しない。実装は値に触れない。
- デプロイ後の実ライブ検証（往復・実タグ付け）は env/トークン設置後にユーザーと実施（本計画の完了後）。
