# 「本目」フォルダ振り分け＆フォルダ単位ダウンロード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画像に「1本目」〜「N本目」のタグを付け、常時バッジで視認しつつ、本目ごと（または全本目まとめてフォルダ階層付きZIP）でダウンロードできる機能を追加する。

**Architecture:** Google Driveには一切書き込まず、Upstash Redisに新規キー（`folderTagCount:{folderId}`, `folderTags:shared:{folderId}`, `renameMap:shared:{folderId}`）を追加し、既存の`colors`/`memos`と全く同じ「サーバーコンポーネントで初期値取得 → クライアントコンポーネントへprops渡し → API経由で更新」というパターンに従う。ダウンロードは新規APIルートでDrive取得を並列化し、`jszip`（既存の未使用依存）でZIPを組み立てて返す。

**Tech Stack:** Next.js App Router (Server Components + Route Handlers), React state (`useState`/`useCallback`), Upstash Redis (`@upstash/redis`), Google Drive API (`googleapis`), `jszip`。

## Global Constraints

- テストフレームワークは導入しない。検証は `npm run lint` / `npm run build` と、指定された手順でのブラウザ手動確認で行う（[[project の既存慣習に合わせる]]、ユーザー承認済み）
- Google Drive上の実データ・フォルダ構造には一切書き込みを行わない
- 既存の `colors:shared:{folderId}` / `months:shared:{folderId}` / `memos:shared:{folderId}` のRedisキー・APIルートは変更しない
- 1画像につき本目タグは1つのみ（新しい本目を選ぶと上書き）
- リネームは手動入力のみ。自動採番（`4-1`等）は行わない。拡張子は常に元のものを自動付与
- 最大想定規模：本目12個 × 各5枚 ＝ 60枚程度

---

## Task 1: `folder-tags` APIルート

**Files:**
- Create: `app/api/folder-tags/route.ts`

**Interfaces:**
- Consumes: なし（新規）
- Produces: `GET /api/folder-tags?folderId=...` → `{ folderTags: Record<string, number> }`／`POST /api/folder-tags`（body: `{ folderId: string, fileId?: string, fileIds?: string[], tag: number | null }`）→ `{ ok: true }`。以降のタスクはこのエンドポイントを叩く。

- [ ] **Step 1: ファイルを作成**

`app/api/colors/route.ts` と同じ構造で、色コードの代わりに本目番号（`number`）を保存する。

```ts
import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// 本目タグのキー形式: folderTags:shared:{folderId}
// 値: { fileId: 本目番号(number) } のJSON

function getKey(folderId: string) {
  return `folderTags:shared:${folderId}`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  const folderTags = (await kv.get<Record<string, number>>(getKey(folderId))) || {};
  return NextResponse.json({ folderTags });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, fileId, fileIds, tag } = await request.json();
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  const ids: string[] = fileIds ?? (fileId ? [fileId] : []);
  if (ids.length === 0) {
    return NextResponse.json({ error: "fileIdが必要です" }, { status: 400 });
  }

  const key = getKey(folderId);
  const folderTags = (await kv.get<Record<string, number>>(key)) || {};

  for (const id of ids) {
    if (tag === null) {
      delete folderTags[id];
    } else {
      folderTags[id] = tag;
    }
  }

  await kv.set(key, folderTags);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Lintを実行**

Run: `npm run lint`
Expected: エラーなし（既存の警告のみなら問題なし）

- [ ] **Step 3: 動作確認（curlで直接叩く）**

開発サーバーを起動していない場合は `npm run dev` を実行してから、ログイン済みブラウザのDevToolsで `document.cookie` を確認するか、以下のように未ログイン状態でのエラーレスポンスだけ確認する（本APIは`auth()`必須のため、ログインなしでは401が返ることを確認すれば実装が正しく認証チェックしていることが分かる）：

```bash
curl -s -X POST http://localhost:3000/api/folder-tags -H "Content-Type: application/json" -d '{"folderId":"test","fileId":"abc","tag":1}'
```

Expected: `{"error":"未ログイン"}` （401）。ログイン済みでの実際の保存確認はTask 6以降でUIから行う。

- [ ] **Step 4: Commit**

```bash
git add app/api/folder-tags/route.ts
git commit -m "feat: add folder-tags API route for 本目 tagging"
```

---

## Task 2: `folder-tag-count` APIルート

**Files:**
- Create: `app/api/folder-tag-count/route.ts`

**Interfaces:**
- Consumes: なし（新規）
- Produces: `GET /api/folder-tag-count?folderId=...` → `{ count: number }`（未設定時は`5`）／`POST /api/folder-tag-count`（body: `{ folderId: string, count: number }`）→ `{ ok: true }`

- [ ] **Step 1: ファイルを作成**

```ts
import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const DEFAULT_COUNT = 5;

function getKey(folderId: string) {
  return `folderTagCount:${folderId}`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  const count = (await kv.get<number>(getKey(folderId))) ?? DEFAULT_COUNT;
  return NextResponse.json({ count });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, count } = await request.json();
  if (!folderId || typeof count !== "number" || count < 1) {
    return NextResponse.json({ error: "folderId・countが必要です" }, { status: 400 });
  }

  await kv.set(getKey(folderId), count);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Lintを実行**

Run: `npm run lint`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add app/api/folder-tag-count/route.ts
git commit -m "feat: add folder-tag-count API route"
```

---

## Task 3: `rename-map` APIルート

**Files:**
- Create: `app/api/rename-map/route.ts`

**Interfaces:**
- Consumes: なし（新規）
- Produces: `GET /api/rename-map?folderId=...` → `{ renameMap: Record<string, string> }`／`POST /api/rename-map`（body: `{ folderId: string, fileId: string, name: string | null }`）→ `{ ok: true }`

- [ ] **Step 1: ファイルを作成**

```ts
import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// ダウンロード時のカスタムファイル名（拡張子なし）
// キー形式: renameMap:shared:{folderId}

function getKey(folderId: string) {
  return `renameMap:shared:${folderId}`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "folderIdが必要です" }, { status: 400 });
  }

  const renameMap = (await kv.get<Record<string, string>>(getKey(folderId))) || {};
  return NextResponse.json({ renameMap });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { folderId, fileId, name } = await request.json();
  if (!folderId || !fileId) {
    return NextResponse.json({ error: "folderId・fileIdが必要です" }, { status: 400 });
  }

  const key = getKey(folderId);
  const renameMap = (await kv.get<Record<string, string>>(key)) || {};

  if (!name) {
    delete renameMap[fileId];
  } else {
    renameMap[fileId] = name;
  }

  await kv.set(key, renameMap);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Lintを実行**

Run: `npm run lint`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add app/api/rename-map/route.ts
git commit -m "feat: add rename-map API route"
```

---

## Task 4: `download-zip` APIルート

**Files:**
- Create: `app/api/drive/download-zip/route.ts`

**Interfaces:**
- Consumes: なし（新規。既存`app/api/drive/download/route.ts`の単体ダウンロードと同じDrive認証パターンを使うが別ファイル）
- Produces: `POST /api/drive/download-zip`（body: `{ files: { fileId: string; name?: string; folderLabel?: string }[] }`）→ ZIPバイナリ（`Content-Type: application/zip`）、レスポンスヘッダー `X-Failed-Count` に失敗件数。以降のタスク（Task 11）がこのエンドポイントを呼ぶ。

- [ ] **Step 1: ファイルを作成**

```ts
import { auth } from "@/auth";
import { google } from "googleapis";
import JSZip from "jszip";

type ZipFileRequest = { fileId: string; name?: string; folderLabel?: string };

const CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return new Response(JSON.stringify({ error: "未ログイン" }), { status: 401 });
  }

  const { files } = (await request.json()) as { files: ZipFileRequest[] };
  if (!files || files.length === 0) {
    return new Response(JSON.stringify({ error: "filesが必要です" }), { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  const zip = new JSZip();
  let failedCount = 0;

  await mapWithConcurrency(files, CONCURRENCY, async (file) => {
    try {
      const meta = await drive.files.get({
        fileId: file.fileId,
        fields: "name",
        supportsAllDrives: true,
      });
      const originalName = meta.data.name || file.fileId;
      const dotIndex = originalName.lastIndexOf(".");
      const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : "";
      const baseName = file.name ? `${file.name}${ext}` : originalName;

      const res = await drive.files.get(
        { fileId: file.fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" }
      );
      const data = res.data as ArrayBuffer;

      const path = file.folderLabel ? `${file.folderLabel}/${baseName}` : baseName;
      zip.file(path, data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[download-zip] failed:", file.fileId, message);
      failedCount++;
    }
  });

  if (failedCount === files.length) {
    return new Response(JSON.stringify({ error: "全てのファイルの取得に失敗しました" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const buffer = await zip.generateAsync({ type: "arraybuffer" });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="images.zip"`,
      "X-Failed-Count": String(failedCount),
    },
  });
}
```

- [ ] **Step 2: Lintを実行**

Run: `npm run lint`
Expected: エラーなし（`jszip`の型定義が見つからない場合は `npm i --save-dev @types/jszip` を検討するが、jszip 3.xは型を同梱しているため通常は不要）

- [ ] **Step 3: Commit**

```bash
git add app/api/drive/download-zip/route.ts
git commit -m "feat: add download-zip API route with parallel Drive fetch"
```

---

## Task 5: `app/page.tsx` — 初期データ取得とprops渡し

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: Redisキー `folderTagCount:{folderId}` (number), `folderTags:shared:{folderId}` (`Record<string, number>`), `renameMap:shared:{folderId}` (`Record<string, string>`)
- Produces: `ImageGrid`への新規props `initialFolderTagCount: number`, `initialFolderTags: Record<string, number>`, `initialRenameMap: Record<string, string>`（Task 6でこの型を`ImageGrid`のPropsに追加する）

- [ ] **Step 1: 変数宣言を追加**

Find:
```tsx
  let folders: DriveFolder[] = [];
  let colors: Record<string, string> = {};
  let months: Record<string, string> = {};
  let memos: Record<string, MemoEntry> = {};
  let cachedAt: number | null = null;
  let error = "";
```

Replace with:
```tsx
  let folders: DriveFolder[] = [];
  let colors: Record<string, string> = {};
  let months: Record<string, string> = {};
  let memos: Record<string, MemoEntry> = {};
  let folderTagCount = 5;
  let folderTags: Record<string, number> = {};
  let renameMap: Record<string, string> = {};
  let cachedAt: number | null = null;
  let error = "";
```

- [ ] **Step 2: Redisからの取得を追加**

Find:
```tsx
      const memoKey = `memos:shared:${folderId}`;
      memos = (await kv.get<Record<string, MemoEntry>>(memoKey)) || {};
    } catch (e: unknown) {
```

Replace with:
```tsx
      const memoKey = `memos:shared:${folderId}`;
      memos = (await kv.get<Record<string, MemoEntry>>(memoKey)) || {};

      const folderTagCountKey = `folderTagCount:${folderId}`;
      folderTagCount = (await kv.get<number>(folderTagCountKey)) ?? 5;

      const folderTagsKey = `folderTags:shared:${folderId}`;
      folderTags = (await kv.get<Record<string, number>>(folderTagsKey)) || {};

      const renameMapKey = `renameMap:shared:${folderId}`;
      renameMap = (await kv.get<Record<string, string>>(renameMapKey)) || {};
    } catch (e: unknown) {
```

- [ ] **Step 3: `ImageGrid`へのprops渡しを追加**

Find:
```tsx
          <ImageGrid key={folderId} folders={folders} folderId={folderId} initialColors={colors} initialMonths={months} initialMemos={memos} userName={session.user?.name || session.user?.email || ""} />
```

Replace with:
```tsx
          <ImageGrid
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
          />
```

- [ ] **Step 4: ビルドを実行**

Run: `npm run build`
Expected: `ImageGrid`側がまだ新propsを受け取れず型エラーになる。これはTask 6で解消される想定なので、ここでは「`folderTagCount`/`folderTags`/`renameMap`を渡している行で型エラーが出る」ことだけ確認できればOK（`Property 'initialFolderTagCount' does not exist...` のようなエラー）。

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: fetch and pass folder-tag data to ImageGrid"
```

---

## Task 6: `ImageGrid.tsx` — 型・state・派生値・保存系コールバックの追加

**Files:**
- Modify: `app/components/ImageGrid.tsx`

**Interfaces:**
- Consumes: Task 5で渡される`initialFolderTagCount`, `initialFolderTags`, `initialRenameMap` props。Task 1〜3のAPIルート。
- Produces: state `folderTags: Record<string, number>`, `folderTagCount: number`, `renameMap: Record<string, string>`, `folderModeOn: boolean`, `downloadingZip: boolean`。コールバック `applyFolderTag(tag: number | null): Promise<void>`, `saveFolderTagCount(count: number): Promise<void>`, `saveRename(fileId: string, name: string): Promise<void>`。派生値 `NUMBER_TAB_PREFIX`, `activeFolderTagNum: number | null`, `folderTagCountsByNum: Record<number, number>`, `folderTagFolders`, `filteredFolderTagFolders`。以降のタスク（7〜11）はこれらを使う。

- [ ] **Step 1: `NUMBER_TAB_PREFIX`定数を追加**

Find:
```tsx
const COLOR_TABS = [
```

Replace with:
```tsx
const NUMBER_TAB_PREFIX = "num:";

const COLOR_TABS = [
```

- [ ] **Step 2: Propsの型に新フィールドを追加**

Find:
```tsx
type Props = {
  folders: DriveFolder[];
  folderId: string;
  initialColors: Record<string, string>;
  initialMonths: Record<string, string>;
  initialMemos: Record<string, MemoEntry>;
  userName: string;
};
```

Replace with:
```tsx
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
};
```

- [ ] **Step 3: コンポーネント引数とstateを追加**

Find:
```tsx
export default function ImageGrid({ folders, folderId, initialColors, initialMonths, initialMemos, userName }: Props) {
  const [colors, setColors] = useState<Record<string, string>>(initialColors);
  const [months, setMonths] = useState<Record<string, string>>(initialMonths);
```

Replace with:
```tsx
export default function ImageGrid({ folders, folderId, initialColors, initialMonths, initialMemos, initialFolderTagCount, initialFolderTags, initialRenameMap, userName }: Props) {
  const [colors, setColors] = useState<Record<string, string>>(initialColors);
  const [months, setMonths] = useState<Record<string, string>>(initialMonths);
  const [folderTags, setFolderTags] = useState<Record<string, number>>(initialFolderTags);
  const [folderTagCount, setFolderTagCount] = useState<number>(initialFolderTagCount);
  const [renameMap, setRenameMap] = useState<Record<string, string>>(initialRenameMap);
  const [folderModeOn, setFolderModeOn] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
```

- [ ] **Step 4: 保存系コールバックを追加**

Find:
```tsx
  const handleOpenAllUrls = useCallback(() => {
```

Replace with:
```tsx
  const applyFolderTag = useCallback(async (tag: number | null) => {
    if (selected.size === 0) return;
    setSaving(true);
    const ids = Array.from(selected);

    setFolderTags(prev => {
      const next = { ...prev };
      for (const id of ids) {
        if (tag === null) delete next[id];
        else next[id] = tag;
      }
      return next;
    });
    setSelected(new Set());

    await fetch("/api/folder-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, fileIds: ids, tag }),
    });
    setSaving(false);
  }, [selected, folderId]);

  const saveFolderTagCount = useCallback(async (count: number) => {
    setFolderTagCount(count);
    await fetch("/api/folder-tag-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, count }),
    });
  }, [folderId]);

  const saveRename = useCallback(async (fileId: string, name: string) => {
    setRenameMap(prev => {
      const next = { ...prev };
      if (!name) delete next[fileId];
      else next[fileId] = name;
      return next;
    });
    await fetch("/api/rename-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, fileId, name: name || null }),
    });
  }, [folderId]);

  const handleOpenAllUrls = useCallback(() => {
```

- [ ] **Step 5: 派生値を追加**

Find:
```tsx
  const colorTabImages = activeTab !== "all"
    ? allImagesWithPath.filter(({ image }) => colors[image.id] === activeTab)
    : [];
```

Replace with:
```tsx
  const activeFolderTagNum = activeTab.startsWith(NUMBER_TAB_PREFIX)
    ? Number(activeTab.slice(NUMBER_TAB_PREFIX.length))
    : null;

  const folderTagNumbers = Array.from({ length: folderTagCount }, (_, i) => i + 1);

  const folderTagCountsByNum = folderTagNumbers.reduce((acc, n) => {
    acc[n] = allImagesWithPath.filter(({ image }) => folderTags[image.id] === n).length;
    return acc;
  }, {} as Record<number, number>);

  const folderTagFolders = activeFolderTagNum !== null
    ? folders
      .map(folder => ({
        ...folder,
        images: folder.images.filter(img => folderTags[img.id] === activeFolderTagNum),
      }))
      .filter(folder => folder.images.length > 0)
    : [];

  const colorTabImages = activeTab !== "all"
    ? allImagesWithPath.filter(({ image }) => colors[image.id] === activeTab)
    : [];
```

- [ ] **Step 6: `filteredFolderTagFolders`を検索フィルタと一緒に追加**

Find:
```tsx
  const filteredColorTabFolders = searchTerms.length > 0
    ? colorTabFolders.filter(f => matchesSearch(f.path))
    : colorTabFolders;
```

Replace with:
```tsx
  const filteredColorTabFolders = searchTerms.length > 0
    ? colorTabFolders.filter(f => matchesSearch(f.path))
    : colorTabFolders;

  const filteredFolderTagFolders = searchTerms.length > 0
    ? folderTagFolders.filter(f => matchesSearch(f.path))
    : folderTagFolders;
```

- [ ] **Step 7: `RenameInput`サブコンポーネントを追加**

Find:
```tsx
type Props = {
```

Replace with:
```tsx
function RenameInput({
  fileId,
  initialValue,
  originalName,
  onSave,
}: {
  fileId: string;
  initialValue: string;
  originalName: string;
  onSave: (fileId: string, name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <input
      type="text"
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initialValue) onSave(fileId, value);
      }}
      placeholder={originalName}
      className="w-full text-xs px-1 py-0.5 border rounded mt-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
    />
  );
}

type Props = {
```

- [ ] **Step 8: ビルドを実行**

Run: `npm run build`
Expected: 成功（型エラーなし）。Task 5で出ていた「新propsが存在しない」エラーが解消されていることを確認する。

- [ ] **Step 9: Commit**

```bash
git add app/components/ImageGrid.tsx
git commit -m "feat: add folder-tag state, derived values, and save callbacks"
```

---

## Task 7: モード切り替え・本目タブ・サイドバー操作ボタン

**Files:**
- Modify: `app/components/ImageGrid.tsx`

**Interfaces:**
- Consumes: Task 6の`folderModeOn`, `folderTagNumbers`, `folderTagCountsByNum`, `applyFolderTag`, `NUMBER_TAB_PREFIX`
- Produces: 画像を選択して番号タブを押すと`folderTags`が更新される、というユーザー操作フロー全体。以降のタスク（バッジ・フィルタ表示・ダウンロード）はこの状態を前提にする。

- [ ] **Step 1: タブバーにモード切り替えボタンと本目タブを追加**

Find:
```tsx
          {COLOR_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.value
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.emoji} {tab.label}
              {months[tab.value] && (
                <span className="ml-1 text-xs font-normal text-orange-500">{months[tab.value]}</span>
              )}
              （{colorCounts[tab.value]}）
            </button>
          ))}
          <button
            onClick={() => { setShowImport(v => !v); setImportStatus(""); }}
            className="ml-auto self-center text-xs px-2 py-1 rounded border border-gray-300 hover:border-gray-400 text-gray-500"
          >
            📥 インポート
          </button>
```

Replace with:
```tsx
          <button
            onClick={() => { setFolderModeOn(v => !v); setActiveTab("all"); }}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              folderModeOn
                ? "border-purple-500 text-purple-600"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            🔢 本数振り分け
          </button>
          {folderModeOn ? (
            folderTagNumbers.map(n => (
              <button
                key={n}
                onClick={() => setActiveTab(`${NUMBER_TAB_PREFIX}${n}`)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === `${NUMBER_TAB_PREFIX}${n}`
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {n}本目（{folderTagCountsByNum[n] || 0}）
              </button>
            ))
          ) : (
            COLOR_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.value
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.emoji} {tab.label}
                {months[tab.value] && (
                  <span className="ml-1 text-xs font-normal text-orange-500">{months[tab.value]}</span>
                )}
                （{colorCounts[tab.value]}）
              </button>
            ))
          )}
          <button
            onClick={() => { setShowImport(v => !v); setImportStatus(""); }}
            className="ml-auto self-center text-xs px-2 py-1 rounded border border-gray-300 hover:border-gray-400 text-gray-500"
          >
            📥 インポート
          </button>
```

- [ ] **Step 2: サイドバーの操作ボタンを、色ラベル用と本目用で切り替える**

Find:
```tsx
        {COLOR_TABS.map(c => (
          <button
            key={c.value}
            onClick={() => {
              if (c.value === GRAY) {
                setConfirmDialog({
                  message: `選択中の ${selected.size}枚 をグレー（NG）にします。よろしいですか？`,
                  onConfirm: () => applyColor(c.value),
                });
              } else {
                applyColor(c.value);
              }
            }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:opacity-80 transition-all font-medium"
            style={{ backgroundColor: c.value }}
            title={c.label}
          >
            {c.emoji} {c.label}
          </button>
        ))}
        <button
          onClick={() => setConfirmDialog({
            message: `選択中の ${selected.size}枚 の色を消します。よろしいですか？`,
            onConfirm: () => applyColor(null),
          })}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-gray-300 hover:bg-gray-50 text-gray-600"
        >
          ⬜ 色を消す
        </button>
```

Replace with:
```tsx
        {!folderModeOn && COLOR_TABS.map(c => (
          <button
            key={c.value}
            onClick={() => {
              if (c.value === GRAY) {
                setConfirmDialog({
                  message: `選択中の ${selected.size}枚 をグレー（NG）にします。よろしいですか？`,
                  onConfirm: () => applyColor(c.value),
                });
              } else {
                applyColor(c.value);
              }
            }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:opacity-80 transition-all font-medium"
            style={{ backgroundColor: c.value }}
            title={c.label}
          >
            {c.emoji} {c.label}
          </button>
        ))}
        {!folderModeOn && (
          <button
            onClick={() => setConfirmDialog({
              message: `選択中の ${selected.size}枚 の色を消します。よろしいですか？`,
              onConfirm: () => applyColor(null),
            })}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-gray-300 hover:bg-gray-50 text-gray-600"
          >
            ⬜ 色を消す
          </button>
        )}
        {folderModeOn && folderTagNumbers.map(n => (
          <button
            key={n}
            onClick={() => applyFolderTag(n)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-purple-300 hover:bg-purple-50 text-purple-700 font-medium"
          >
            🔢 {n}本目
          </button>
        ))}
        {folderModeOn && (
          <button
            onClick={() => applyFolderTag(null)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-gray-300 hover:bg-gray-50 text-gray-600"
          >
            ⬜ 本目を消す
          </button>
        )}
```

- [ ] **Step 3: ビルドを実行**

Run: `npm run build`
Expected: 成功

- [ ] **Step 4: ブラウザで手動確認**

1. `npm run dev` を起動し、画像のあるフォルダを開く
2. 「🔢 本数振り分け」ボタンを押す → タブが「1本目」〜「5本目」に切り替わり、サイドバーの色ボタンが消える（画像未選択時はサイドバー自体が非表示）
3. 画像を数枚クリックして選択 → サイドバーに「🔢 1本目」〜「🔢 5本目」ボタンが表示されることを確認
4. 「🔢 2本目」を押す → 選択が解除され、保存中インジケーターが一瞬表示される
5. ページをリロード（`refresh=1`は不要、通常リロードでキャッシュから復元される）→ 「🔢 本数振り分け」を再度ONにし「2本目」タブのカウントが増えていることを確認（永続化されている）

- [ ] **Step 5: Commit**

```bash
git add app/components/ImageGrid.tsx
git commit -m "feat: add 本目 mode toggle, tabs, and sidebar tagging buttons"
```

---

## Task 8: サムネイルへの本目バッジ表示

**Files:**
- Modify: `app/components/ImageGrid.tsx`

**Interfaces:**
- Consumes: Task 6の`folderTags`state、既存の`renderImage`関数（`colors`/`selected`/`memos`を閉包で参照している箇所）
- Produces: `folderTags`にタグがある画像のサムネイル左上に番号バッジを表示（`folderModeOn`のON/OFFに関わらず常時表示）

- [ ] **Step 1: バッジのJSXを追加**

Find:
```tsx
          {/* 選択オーバーレイ */}
          {isSelected && (
```

Replace with:
```tsx
          {/* 本目タグバッジ（常時表示） */}
          {folderTags[image.id] && (
            <div className="absolute top-1 left-1 z-10 bg-black/70 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {folderTags[image.id]}
            </div>
          )}
          {/* 選択オーバーレイ */}
          {isSelected && (
```

- [ ] **Step 2: ビルドを実行**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: ブラウザで手動確認**

Task 7の手順で「2本目」タグを付けた画像が、モードをOFFにした通常一覧・色タブ一覧のどこに表示されていても、サムネイル左上に小さく「2」というバッジが常時表示されることを確認する。

- [ ] **Step 4: Commit**

```bash
git add app/components/ImageGrid.tsx
git commit -m "feat: show persistent 本目 badge on thumbnails"
```

---

## Task 9: 本数（folderTagCount）のインライン設定

**Files:**
- Modify: `app/components/ImageGrid.tsx`

**Interfaces:**
- Consumes: Task 6の`folderTagCount`, `saveFolderTagCount`
- Produces: state `editingFolderTagCount: boolean`, `folderTagCountInput: string`。⚙️アイコンから本数を変更できるUI。

- [ ] **Step 1: stateを追加**

Find:
```tsx
  const [folderModeOn, setFolderModeOn] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
```

Replace with:
```tsx
  const [folderModeOn, setFolderModeOn] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [editingFolderTagCount, setEditingFolderTagCount] = useState(false);
  const [folderTagCountInput, setFolderTagCountInput] = useState("");
```

- [ ] **Step 2: 本目タブの末尾に設定UIを追加**

Find:
```tsx
          {folderModeOn ? (
            folderTagNumbers.map(n => (
              <button
                key={n}
                onClick={() => setActiveTab(`${NUMBER_TAB_PREFIX}${n}`)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === `${NUMBER_TAB_PREFIX}${n}`
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {n}本目（{folderTagCountsByNum[n] || 0}）
              </button>
            ))
          ) : (
```

Replace with:
```tsx
          {folderModeOn ? (
            <>
              {folderTagNumbers.map(n => (
                <button
                  key={n}
                  onClick={() => setActiveTab(`${NUMBER_TAB_PREFIX}${n}`)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === `${NUMBER_TAB_PREFIX}${n}`
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {n}本目（{folderTagCountsByNum[n] || 0}）
                </button>
              ))}
              {editingFolderTagCount ? (
                <span className="flex items-center gap-1 self-center ml-1">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={folderTagCountInput}
                    onChange={e => setFolderTagCountInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        saveFolderTagCount(Math.max(1, Number(folderTagCountInput) || 1));
                        setEditingFolderTagCount(false);
                      }
                      if (e.key === "Escape") setEditingFolderTagCount(false);
                    }}
                    className="w-14 border rounded px-1 py-0.5 text-xs"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      saveFolderTagCount(Math.max(1, Number(folderTagCountInput) || 1));
                      setEditingFolderTagCount(false);
                    }}
                    className="text-xs px-2 py-0.5 rounded bg-blue-500 text-white"
                  >
                    保存
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => { setEditingFolderTagCount(true); setFolderTagCountInput(String(folderTagCount)); }}
                  className="text-xs px-2 py-1 self-center text-gray-400 hover:text-gray-600"
                  title="本数を設定"
                >
                  ⚙️ {folderTagCount}本まで
                </button>
              )}
            </>
          ) : (
```

- [ ] **Step 3: ビルドを実行**

Run: `npm run build`
Expected: 成功

- [ ] **Step 4: ブラウザで手動確認**

1. 本数振り分けモードをON
2. 「⚙️ 5本まで」を押し、数値入力欄に`8`を入力して「保存」→ タブが「1本目」〜「8本目」の8個に増える
3. ページをリロードし、モードをONにして8本目まで表示されることを確認（永続化確認）

- [ ] **Step 5: Commit**

```bash
git add app/components/ImageGrid.tsx
git commit -m "feat: add inline folder-tag-count settings editor"
```

---

## Task 10: 「Xの本目のみ表示」フィルタ画面とリネーム欄

**Files:**
- Modify: `app/components/ImageGrid.tsx`

**Interfaces:**
- Consumes: Task 6の`activeFolderTagNum`, `filteredFolderTagFolders`, `renameMap`, `saveRename`, `RenameInput`
- Produces: 番号タブを選ぶと、その本目の画像だけが一覧表示され、各画像の下にリネーム入力欄が出るUI。

- [ ] **Step 1: 色別タブ表示ブロックの直後に本目フィルタ表示ブロックを追加**

Find:
```tsx
          ) : (
            <div className="text-center text-gray-400 py-10">
              {searchQuery ? `「${searchQuery}」に一致するフォルダはありません` : "この色がついた画像はまだありません"}
            </div>
          )}
        </>
      )}

      {/* 選択中の左サイドバー */}
```

Replace with:
```tsx
          ) : (
            <div className="text-center text-gray-400 py-10">
              {searchQuery ? `「${searchQuery}」に一致するフォルダはありません` : "この色がついた画像はまだありません"}
            </div>
          )}
        </>
      )}

      {/* 本目タグ別フィルタ表示 */}
      {activeFolderTagNum !== null && (
        <>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-sm text-gray-500">
              {activeFolderTagNum}本目：{filteredFolderTagFolders.reduce((sum, f) => sum + f.images.length, 0)}枚
            </span>
            <button
              onClick={() => downloadFolderTagZip(activeFolderTagNum)}
              disabled={downloadingZip || filteredFolderTagFolders.length === 0}
              className="ml-auto text-sm px-3 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50"
            >
              {downloadingZip ? "⏳ DL中..." : `📦 ${activeFolderTagNum}本目をダウンロード`}
            </button>
          </div>

          {filteredFolderTagFolders.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
              {filteredFolderTagFolders.flatMap(folder => folder.images).map(image => (
                <div key={image.id}>
                  {renderImage(image)}
                  <RenameInput
                    fileId={image.id}
                    initialValue={renameMap[image.id] || ""}
                    originalName={image.name}
                    onSave={saveRename}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-10">
              {searchQuery ? `「${searchQuery}」に一致するフォルダはありません` : "この本目にはまだ画像がありません"}
            </div>
          )}
        </>
      )}

      {/* 選択中の左サイドバー */}
```

- [ ] **Step 2: ビルドを実行**

Run: `npm run build`
Expected: `downloadFolderTagZip`が未定義のため型エラー。Task 11で解消される想定。

- [ ] **Step 3: Commit**

```bash
git add app/components/ImageGrid.tsx
git commit -m "feat: add per-本目 filtered view with rename inputs"
```

---

## Task 11: ダウンロードボタンの実装（本目ごと・全件一括）

**Files:**
- Modify: `app/components/ImageGrid.tsx`

**Interfaces:**
- Consumes: Task 4の`POST /api/drive/download-zip`、Task 6の`allImagesWithPath`, `folderTags`, `renameMap`, `downloadingZip`
- Produces: `downloadZipBlob`, `downloadFolderTagZip(n: number)`, `downloadAllFolderTagsZip()` — Task 10で参照している`downloadFolderTagZip`を実装する。

- [ ] **Step 1: ダウンロード用コールバックを追加**

Find:
```tsx
  const handleImport = useCallback(async () => {
```

Replace with:
```tsx
  const downloadZipBlob = useCallback(async (
    files: { fileId: string; name?: string; folderLabel?: string }[],
    zipName: string
  ) => {
    if (files.length === 0) return;
    setDownloadingZip(true);
    try {
      const res = await fetch("/api/drive/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      if (!res.ok) throw new Error("失敗");
      const failedCount = Number(res.headers.get("X-Failed-Count") || 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);
      if (failedCount > 0) {
        alert(`${failedCount}件のダウンロードに失敗しました`);
      }
    } catch {
      alert("ダウンロードに失敗しました");
    } finally {
      setDownloadingZip(false);
    }
  }, []);

  const downloadFolderTagZip = useCallback((n: number) => {
    const files = allImagesWithPath
      .filter(({ image }) => folderTags[image.id] === n)
      .map(({ image }) => ({
        fileId: image.id,
        name: renameMap[image.id] || undefined,
      }));
    downloadZipBlob(files, `${n}本目.zip`);
  }, [allImagesWithPath, folderTags, renameMap, downloadZipBlob]);

  const downloadAllFolderTagsZip = useCallback(() => {
    const files = allImagesWithPath
      .filter(({ image }) => folderTags[image.id])
      .map(({ image }) => ({
        fileId: image.id,
        name: renameMap[image.id] || undefined,
        folderLabel: `${folderTags[image.id]}本目`,
      }));
    downloadZipBlob(files, "全本目.zip");
  }, [allImagesWithPath, folderTags, renameMap, downloadZipBlob]);

  const handleImport = useCallback(async () => {
```

- [ ] **Step 2: 「全てダウンロード」ボタンをタブバーに追加**

Find:
```tsx
              ) : (
                <button
                  onClick={() => { setEditingFolderTagCount(true); setFolderTagCountInput(String(folderTagCount)); }}
                  className="text-xs px-2 py-1 self-center text-gray-400 hover:text-gray-600"
                  title="本数を設定"
                >
                  ⚙️ {folderTagCount}本まで
                </button>
              )}
            </>
          ) : (
```

Replace with:
```tsx
              ) : (
                <button
                  onClick={() => { setEditingFolderTagCount(true); setFolderTagCountInput(String(folderTagCount)); }}
                  className="text-xs px-2 py-1 self-center text-gray-400 hover:text-gray-600"
                  title="本数を設定"
                >
                  ⚙️ {folderTagCount}本まで
                </button>
              )}
              <button
                onClick={downloadAllFolderTagsZip}
                disabled={downloadingZip}
                className="text-xs px-3 py-1.5 self-center rounded border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50"
              >
                {downloadingZip ? "⏳ DL中..." : "📦 全てダウンロード"}
              </button>
            </>
          ) : (
```

- [ ] **Step 3: ビルドを実行**

Run: `npm run build`
Expected: 成功（Task 10で出ていた`downloadFolderTagZip`未定義エラーが解消）

- [ ] **Step 4: ブラウザで手動確認**

1. 2〜3枚の画像に「1本目」、別の2枚に「2本目」タグを付ける
2. 「1本目」タブを開き、リネーム欄に任意の名前を入力してフォーカスを外す（`onBlur`で保存される）
3. 「📦 1本目をダウンロード」を押す → `1本目.zip`がダウンロードされ、展開するとリネームした画像は指定した名前＋元の拡張子、リネームしていない画像は元のファイル名になっていることを確認
4. 「📦 全てダウンロード」を押す → `全本目.zip`がダウンロードされ、展開すると`1本目/`, `2本目/`というディレクトリに正しく画像が分かれていることを確認

- [ ] **Step 5: Commit**

```bash
git add app/components/ImageGrid.tsx
git commit -m "feat: wire up per-本目 and all-本目 zip download buttons"
```

---

## Task 12: 最終確認（Lint・ビルド・手動E2E）

**Files:** なし（確認のみ）

- [ ] **Step 1: Lintを実行**

Run: `npm run lint`
Expected: エラーなし

- [ ] **Step 2: ビルドを実行**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: 通しの手動確認**

1. 既存機能（色ラベル付け、色タブでの絞り込み、既存の一括ダウンロード、メモ機能）が今回の変更で壊れていないことを確認
2. 本数振り分けモードON → 画像選択 → 番号タブでタグ付け → OFFにしても他機能が正常に動くことを確認
3. 本数設定を変更してもタグ付け済みの画像のタグ番号が消えないことを確認（`folderTagCount`を減らしても`folderTags`のデータ自体は削除されないため、タブの表示範囲外になるだけで消えないことを明示的に確認）
4. 「全てダウンロード」でタグなし画像が含まれていないことを確認

- [ ] **Step 4: Commit（最終まとめが必要な場合のみ）**

変更漏れがなければ追加コミットは不要。

