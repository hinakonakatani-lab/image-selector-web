# Memo/Folder-Tag Permission Restrictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing 3-tier role system so that the "restricted" role also loses access to the memo (add/edit/delete) and folder-tag/"本数モード" (number-tab assignment) features, while keeping existing memo text and folder-tag badges visible (view-only for restricted users).

**Architecture:** Add two new pure capability functions to the existing `config/permissions.ts` (`canEditMemos`, `canUseFolderTagFeature`), following the exact pattern of the already-shipped `canImport`/`canUseColorFeatures`. `app/page.tsx` computes both once per request and passes them down as props to `ImageGrid`, and uses `canUseFolderTagFeature` to conditionally render the `FolderTagVisibilityToggle` button. `ImageGrid.tsx` combines its existing client-side `showFolderTagUI` toggle state with the new `canUseFolderTag` prop into a single derived flag, and gates the memo add/edit/delete UI (but not memo/badge display) behind `canEditMemo`. Three API routes (`/api/memos`, `/api/folder-tags`, `/api/folder-tag-count`) get the same 403 enforcement pattern already used in `/api/colors`, `/api/import`, `/api/manual-color`.

**Tech Stack:** Next.js App Router (server components + API routes), NextAuth v5 (`auth()`), TypeScript. No new dependencies.

## Global Constraints

- Email/role comparisons are case-insensitive (already handled inside `getRole` — do not duplicate normalization elsewhere).
- No new database/table. Role is derived from `config/permissions.ts` on every request; nothing new is persisted to Redis.
- Existing data (memo text on thumbnails, folder-tag number badges on thumbnails) must remain visible to restricted users — only the controls that create/change/delete that data are hidden. Do not hide `folderTags[image.id]` badge rendering or the memo text span inside `renderImage`.
- Do not change behavior for admin or general-role users — every UI element and API route must behave exactly as before for those two roles.
- No automated test suite exists in this repo; verification is manual (`npx tsc --noEmit` for type-checking after each task, `npm run build` + manual browser click-through at the end), per Task 6.

---

### Task 1: Extend the permissions config module

**Files:**
- Modify: `config/permissions.ts`

**Interfaces:**
- Consumes: nothing new (extends the existing `Role` type and `getRole` from the same file).
- Produces: `export function canEditMemos(role: Role): boolean`, `export function canUseFolderTagFeature(role: Role): boolean`. Tasks 2, 3, 4 import these from `@/config/permissions`.

- [ ] **Step 1: Update the file header comment**

In `config/permissions.ts`, replace this line:

```ts
// ③制限付与ユーザー: 「インポート」「色タブ」関連の機能が使用できません
```

with:

```ts
// ③制限付与ユーザー: 「インポート」「色タブ」「メモ」「本数モード」関連の機能が使用できません
```

- [ ] **Step 2: Add the two new capability functions**

At the end of `config/permissions.ts`, after the existing `canUseColorFeatures` function, add:

```ts

export function canEditMemos(role: Role): boolean {
  return role !== "restricted";
}

export function canUseFolderTagFeature(role: Role): boolean {
  return role !== "restricted";
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `config/permissions.ts`

- [ ] **Step 4: Commit**

```bash
git add config/permissions.ts
git commit -m "feat: add canEditMemos and canUseFolderTagFeature to permissions config"
```

---

### Task 2: Wire the new capabilities into `app/page.tsx`

**Files:**
- Modify: `app/page.tsx:17` (import), `app/page.tsx:93-96` (capability computation), `app/page.tsx:212` (`FolderTagVisibilityToggle`), `app/page.tsx:283-296` (`ImageGrid` props)

**Interfaces:**
- Consumes: `canEditMemos`, `canUseFolderTagFeature` from `@/config/permissions` (Task 1).
- Produces: `ImageGrid` now receives `canEditMemo` and `canUseFolderTag` props. Tasks 3 depends on these prop names exactly.

- [ ] **Step 1: Import the two new functions**

Replace this line (currently line 17):

```ts
import { getRole, canImport as canImportFn, canUseColorFeatures } from "@/config/permissions";
```

with:

```ts
import { getRole, canImport as canImportFn, canUseColorFeatures, canEditMemos, canUseFolderTagFeature } from "@/config/permissions";
```

- [ ] **Step 2: Compute the two new capability booleans**

Replace this block (currently lines 93-96):

```ts
  const role = getRole(session?.user?.email);
  const isAdmin = role === "admin";
  const canImport = canImportFn(role);
  const canUseColor = canUseColorFeatures(role);
```

with:

```ts
  const role = getRole(session?.user?.email);
  const isAdmin = role === "admin";
  const canImport = canImportFn(role);
  const canUseColor = canUseColorFeatures(role);
  const canEditMemo = canEditMemos(role);
  const canUseFolderTag = canUseFolderTagFeature(role);
```

- [ ] **Step 3: Conditionally render `FolderTagVisibilityToggle`**

Replace this line (currently line 212):

```tsx
          <FolderTagVisibilityToggle />
```

with:

```tsx
          {canUseFolderTag && <FolderTagVisibilityToggle />}
```

- [ ] **Step 4: Pass the two new props to `ImageGrid`**

In the `ImageGrid` call, add `canEditMemo={canEditMemo}` and `canUseFolderTag={canUseFolderTag}` as new props, e.g.:

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
            canUseColor={canUseColor}
            canEditMemo={canEditMemo}
            canUseFolderTag={canUseFolderTag}
          />
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: errors will appear because `ImageGrid`'s `Props` type doesn't yet declare `canEditMemo`/`canUseFolderTag` — that's expected until Task 3 is done. Confirm the only new errors are about `canEditMemo`/`canUseFolderTag` not existing on `ImageGrid`'s prop type (nothing else changes).

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat: compute memo/folder-tag capabilities in page.tsx and pass to ImageGrid"
```

---

### Task 3: Gate folder-tag and memo UI in `ImageGrid.tsx`

**Files:**
- Modify: `app/components/ImageGrid.tsx:54-67` (props type + destructuring)
- Modify: `app/components/ImageGrid.tsx:74` (derived `folderTagUIEnabled` constant)
- Modify: `app/components/ImageGrid.tsx:130-135` (activeTab reset effect)
- Modify: `app/components/ImageGrid.tsx:882` (number-tab toolbar row)
- Modify: `app/components/ImageGrid.tsx:1295,1304` (sidebar folder-tag buttons)
- Modify: `app/components/ImageGrid.tsx:785-794` (per-thumbnail memo button in `renderImage`)
- Modify: `app/components/ImageGrid.tsx:1312-1327` (sidebar memo buttons)

**Interfaces:**
- Consumes: `canEditMemo` and `canUseFolderTag` props passed from `app/page.tsx` (Task 2).
- Produces: nothing new consumed elsewhere; closes out Task 2's remaining type errors.

- [ ] **Step 1: Add the two new props to the props type and destructuring**

Replace lines 54-67:

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
  canUseColor?: boolean;
};

export default function ImageGrid({ folders, folderId, initialColors, initialMonths, initialMemos, initialFolderTagCount, initialFolderTags, initialRenameMap, userName, canUseColor = true }: Props) {
```

with:

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
  canUseColor?: boolean;
  canEditMemo?: boolean;
  canUseFolderTag?: boolean;
};

export default function ImageGrid({ folders, folderId, initialColors, initialMonths, initialMemos, initialFolderTagCount, initialFolderTags, initialRenameMap, userName, canUseColor = true, canEditMemo = true, canUseFolderTag = true }: Props) {
```

- [ ] **Step 2: Derive a single `folderTagUIEnabled` flag**

Replace this line (currently line 74):

```tsx
  const showFolderTagUI = useFolderTagVisibility();
```

with:

```tsx
  const showFolderTagUI = useFolderTagVisibility();
  const folderTagUIEnabled = showFolderTagUI && canUseFolderTag;
```

- [ ] **Step 3: Use the derived flag in the activeTab reset effect**

Replace this block (currently lines 130-135):

```tsx
  // 本数振り分けUIがOFFになったら、本目タブを表示中なら「全て」に戻す
  useEffect(() => {
    if (!showFolderTagUI) {
      setActiveTab(current => (current.startsWith(NUMBER_TAB_PREFIX) ? "all" : current));
    }
  }, [showFolderTagUI]);
```

with:

```tsx
  // 本数振り分けUIがOFFになったら、本目タブを表示中なら「全て」に戻す
  useEffect(() => {
    if (!folderTagUIEnabled) {
      setActiveTab(current => (current.startsWith(NUMBER_TAB_PREFIX) ? "all" : current));
    }
  }, [folderTagUIEnabled]);
```

- [ ] **Step 4: Gate the number-tab toolbar row**

Replace this line (currently line 882):

```tsx
        {showFolderTagUI && (
```

with:

```tsx
        {folderTagUIEnabled && (
```

(This one conditional wraps the entire number-tab row block, including the tab buttons, the folder-tag-count editor, and the "📦 全てダウンロード（本目ごと）" button — all of it is part of the folder-tag feature, so gating the outer condition is sufficient. No other lines in this block need to change.)

- [ ] **Step 5: Gate the sidebar folder-tag assignment buttons**

Replace this line (currently line 1295):

```tsx
        {showFolderTagUI && folderTagNumbers.map(n => (
```

with:

```tsx
        {folderTagUIEnabled && folderTagNumbers.map(n => (
```

Replace this line (currently line 1304):

```tsx
        {showFolderTagUI && (
```

with:

```tsx
        {folderTagUIEnabled && (
```

- [ ] **Step 6: Gate the per-thumbnail memo button in `renderImage`**

Replace this block (currently lines 785-794):

```tsx
        {/* メモ */}
        <button
          className={`w-full text-left text-xs px-1 py-0.5 truncate transition-colors ${
            memo
              ? "bg-yellow-50 text-gray-700 hover:bg-yellow-100"
              : "text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-50"
          }`}
          onClick={() => openMemoModal(image.id)}
          title={memo?.text}
        >
          {memo ? `📝 ${memo.text}` : "＋ メモ"}
        </button>
```

with:

```tsx
        {/* メモ */}
        {memo ? (
          <button
            className={`w-full text-left text-xs px-1 py-0.5 truncate transition-colors bg-yellow-50 text-gray-700 ${
              canEditMemo ? "hover:bg-yellow-100" : "cursor-default"
            }`}
            onClick={canEditMemo ? () => openMemoModal(image.id) : undefined}
            title={memo.text}
          >
            📝 {memo.text}
          </button>
        ) : canEditMemo ? (
          <button
            className="w-full text-left text-xs px-1 py-0.5 truncate transition-colors text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-50"
            onClick={() => openMemoModal(image.id)}
          >
            ＋ メモ
          </button>
        ) : null}
```

- [ ] **Step 7: Gate the sidebar memo buttons**

Replace this block (currently lines 1312-1327):

```tsx
        {selected.size === 1 && (
          <button
            onClick={() => openMemoModal([...selected][0])}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-yellow-700 border border-yellow-300 hover:bg-yellow-50"
          >
            📝 {memos[[...selected][0]] ? "メモ編集" : "メモ追加"}
          </button>
        )}
        {selectedWithMemos > 0 && selected.size > 1 && (
          <button
            onClick={() => setConfirmDialog({ message: `選択中の ${selectedWithMemos}件 のメモを削除します。よろしいですか？`, onConfirm: handleBulkDeleteMemos })}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-yellow-700 border border-yellow-300 hover:bg-yellow-50"
          >
            📝 メモ削除（{selectedWithMemos}件）
          </button>
        )}
```

with:

```tsx
        {canEditMemo && selected.size === 1 && (
          <button
            onClick={() => openMemoModal([...selected][0])}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-yellow-700 border border-yellow-300 hover:bg-yellow-50"
          >
            📝 {memos[[...selected][0]] ? "メモ編集" : "メモ追加"}
          </button>
        )}
        {canEditMemo && selectedWithMemos > 0 && selected.size > 1 && (
          <button
            onClick={() => setConfirmDialog({ message: `選択中の ${selectedWithMemos}件 のメモを削除します。よろしいですか？`, onConfirm: handleBulkDeleteMemos })}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-yellow-700 border border-yellow-300 hover:bg-yellow-50"
          >
            📝 メモ削除（{selectedWithMemos}件）
          </button>
        )}
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere (this closes out the errors introduced in Task 2)

- [ ] **Step 9: Commit**

```bash
git add app/components/ImageGrid.tsx
git commit -m "feat: gate folder-tag and memo edit UI behind role capabilities"
```

---

### Task 4: Enforce role in the memo/folder-tag API routes (backend)

**Files:**
- Modify: `app/api/memos/route.ts:1,30-34`
- Modify: `app/api/folder-tags/route.ts:1,33-37`
- Modify: `app/api/folder-tag-count/route.ts:1,32-36`

**Interfaces:**
- Consumes: `getRole`, `canEditMemos`, `canUseFolderTagFeature` from `@/config/permissions` (Task 1).
- Produces: nothing new consumed by other tasks; API-only, independent of Tasks 2/3.

- [ ] **Step 1: `app/api/memos/route.ts` — block restricted users on `POST`**

Add to the imports (after line 1 `import { auth } from "@/auth";`):

```ts
import { getRole, canEditMemos } from "@/config/permissions";
```

Replace lines 30-34:

```ts
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
```

with:

```ts
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (!canEditMemos(getRole(session.user.email))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
```

(`GET` is left unchanged — viewing existing memos stays allowed for restricted users.)

- [ ] **Step 2: `app/api/folder-tags/route.ts` — block restricted users on `POST`**

Add to the imports (after line 1 `import { auth } from "@/auth";`):

```ts
import { getRole, canUseFolderTagFeature } from "@/config/permissions";
```

Replace lines 33-37:

```ts
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
```

with:

```ts
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (!canUseFolderTagFeature(getRole(session.user.email))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
```

(`GET` is left unchanged — the always-visible folder-tag badge relies on it staying readable for restricted users.)

- [ ] **Step 3: `app/api/folder-tag-count/route.ts` — block restricted users on `POST`**

Add to the imports (after line 1 `import { auth } from "@/auth";`):

```ts
import { getRole, canUseFolderTagFeature } from "@/config/permissions";
```

Replace lines 32-36:

```ts
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
```

with:

```ts
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (!canUseFolderTagFeature(getRole(session.user.email))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in any of the three route files

- [ ] **Step 5: Commit**

```bash
git add app/api/memos/route.ts app/api/folder-tags/route.ts app/api/folder-tag-count/route.ts
git commit -m "feat: enforce role checks in memos, folder-tags, and folder-tag-count API routes"
```

---

### Task 5: Manual end-to-end verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: nothing (terminal task).

- [ ] **Step 1: Full type-check and production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: server starts on `http://localhost:3000` (or the port it prints).

- [ ] **Step 3: Verify the restricted-user role (using the existing test entry in `RESTRICTED_EMAILS`)**

Log in with the account currently listed in `RESTRICTED_EMAILS`. Open a folder. Confirm:
- The 🔢 folder-tag visibility toggle button is **not** visible in the header
- If a memo already exists on an image (add one first via an admin/general account if none exist), its text is still visible on the thumbnail, but clicking it does **not** open the edit modal
- Thumbnails with no memo show **no** "＋ メモ" hover prompt
- Selecting one or more images does **not** show "📝 メモ追加/メモ編集" or "📝 メモ削除" buttons in the sidebar
- If a folder-tag badge (e.g. "1", "2") was previously assigned to an image, it is still visible on the thumbnail
- No number tabs, folder-tag-count editor, or "📦 全てダウンロード（本目ごと）" button appear anywhere

- [ ] **Step 4: Verify backend enforcement directly**

While still logged in as the restricted test account, open the browser devtools console and run:

```js
fetch("/api/memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId: "SOME_FOLDER_ID", fileId: "SOME_FILE_ID", text: "test" }) }).then(r => r.json()).then(console.log)
```

(substitute a real folder/file ID you have access to). Expected: `{ error: "権限がありません" }` with a 403 status. Repeat for `POST /api/folder-tags` (body: `{ folderId, fileId, tag: 1 }`) and `POST /api/folder-tag-count` (body: `{ folderId, count: 10 }`) — both should also 403.

Then confirm `GET` still works for the restricted account:

```js
fetch("/api/memos?folderId=SOME_FOLDER_ID").then(r => r.json()).then(console.log)
```

Expected: returns the memo data normally (200), not a 403.

- [ ] **Step 5: Verify admin and general roles are unaffected**

Log in as the admin account and as a general (non-listed) account. Confirm the 🔢 toggle, memo add/edit/delete UI, and folder-tag assignment all work exactly as before for both roles.

- [ ] **Step 6: Final commit check**

```bash
git log --oneline -6
git status
```

Expected: clean working tree, and the 4 feature commits from Tasks 1-4 are present on top of the existing history.
