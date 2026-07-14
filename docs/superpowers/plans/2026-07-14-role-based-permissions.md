# Role-Based Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded admin-email check with a 3-tier role system (admin / general / restricted) driven by a single committed config file, enforced both in the UI (hide) and in API routes (403).

**Architecture:** One new file, `config/permissions.ts`, holds two email arrays (`ADMIN_EMAILS`, `RESTRICTED_EMAILS`) and pure functions to derive a role from an email and to answer capability questions (`canAccessAdminBackup`, `canImport`, `canUseColorFeatures`). `app/page.tsx` computes the role once per request and passes booleans down as props. Every API route that currently only checks "logged in or not" additionally checks the role.

**Tech Stack:** Next.js App Router (server components + API routes), NextAuth v5 (`auth()`), TypeScript. No new dependencies.

## Global Constraints

- Email comparisons are case-insensitive (existing code lowercases before comparing — preserve this).
- No new database/table. Role is derived from `config/permissions.ts` on every request; nothing is persisted to Redis.
- `config/permissions.ts` must include a Japanese comment explaining that emails are added here directly, since the user edits this file by hand.
- Do not change behavior for the "💾 このフォルダをバックアップ" (export) button — it must remain available to every logged-in role.
- Do not change behavior for "全て" / "ランダム" tabs in `ImageGrid` — they are not color/import features and stay visible to all roles.
- No automated test suite exists in this repo; verification is manual (`npm run build` for type-checking + `npm run dev` for a manual click-through), per Task 6.

---

### Task 1: Create the permissions config module

**Files:**
- Create: `config/permissions.ts`

**Interfaces:**
- Produces: `export type Role = "admin" | "general" | "restricted"`, `export const ADMIN_EMAILS: string[]`, `export const RESTRICTED_EMAILS: string[]`, `export function getRole(email?: string | null): Role`, `export function canAccessAdminBackup(role: Role): boolean`, `export function canImport(role: Role): boolean`, `export function canUseColorFeatures(role: Role): boolean`. Every later task imports from `@/config/permissions`.

- [ ] **Step 1: Create the config file**

Create `config/permissions.ts` with this exact content:

```ts
// 権限設定ファイル
//
// 管理者・制限付与ユーザーのメールアドレスはここに追加してください。
// このファイルを見れば、現在誰が管理者/制限付与ユーザーとして
// 登録されているかが常に分かります。
//
// ①管理者: 全機能を使用できます
// ②一般ユーザー（下記どちらのリストにも含まれないユーザー）:
//    「全データBK(管理者用)」以外の全機能を使用できます
// ③制限付与ユーザー: 「インポート」「色タブ」関連の機能が使用できません

export const ADMIN_EMAILS: string[] = [
  "hinako.nakatani@shintairiku.jp",
];

export const RESTRICTED_EMAILS: string[] = [
  // 例: "someone@example.com",
];

export type Role = "admin" | "general" | "restricted";

function includesEmail(list: string[], email: string): boolean {
  return list.some((e) => e.toLowerCase() === email);
}

export function getRole(email?: string | null): Role {
  const normalized = (email || "").toLowerCase();
  if (!normalized) return "restricted";
  if (includesEmail(ADMIN_EMAILS, normalized)) return "admin";
  if (includesEmail(RESTRICTED_EMAILS, normalized)) return "restricted";
  return "general";
}

export function canAccessAdminBackup(role: Role): boolean {
  return role === "admin";
}

export function canImport(role: Role): boolean {
  return role !== "restricted";
}

export function canUseColorFeatures(role: Role): boolean {
  return role !== "restricted";
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `config/permissions.ts`

- [ ] **Step 3: Commit**

```bash
git add config/permissions.ts
git commit -m "feat: add role-based permissions config module"
```

---

### Task 2: Wire role into `app/page.tsx` and pass capability props down

**Files:**
- Modify: `app/page.tsx:1-16` (imports), `app/page.tsx:92` (role computation), `app/page.tsx:206-207` (component props)

**Interfaces:**
- Consumes: `getRole`, `canImport`, `canUseColorFeatures` from `@/config/permissions` (Task 1).
- Produces: `ExportImport` now receives a `canImport` prop; `ManualColorPicker` is conditionally rendered; `ImageGrid` receives a `canUseColor` prop. Tasks 3, 4, 5 depend on these prop names.

- [ ] **Step 1: Import the permissions module**

In `app/page.tsx`, add this import near the top (after the existing imports, e.g. after line 16 `import type { DriveFolder } from "@/app/api/drive/route";`):

```ts
import { getRole, canImport as canImportFn, canUseColorFeatures } from "@/config/permissions";
```

(Aliasing `canImport` to `canImportFn` avoids a name collision with the local variable we define next.)

- [ ] **Step 2: Replace the hardcoded admin check**

Replace this line (currently line 92):

```ts
  const isAdmin = (session?.user?.email || "").toLowerCase() === "hinako.nakatani@shintairiku.jp";
```

with:

```ts
  const role = getRole(session?.user?.email);
  const isAdmin = role === "admin";
  const canImport = canImportFn(role);
  const canUseColor = canUseColorFeatures(role);
```

- [ ] **Step 3: Pass `canImport` to `ExportImport`**

Replace this line (currently line 206):

```tsx
          <ExportImport folderId={folderId || undefined} isAdmin={isAdmin} />
```

with:

```tsx
          <ExportImport folderId={folderId || undefined} isAdmin={isAdmin} canImport={canImport} />
```

- [ ] **Step 4: Conditionally render `ManualColorPicker`**

Replace this line (currently line 207):

```tsx
          <ManualColorPicker folderId={folderId} />
```

with:

```tsx
          {canUseColor && <ManualColorPicker folderId={folderId} />}
```

- [ ] **Step 5: Pass `canUseColor` to `ImageGrid`**

In the `ImageGrid` call (currently lines 280-291), add `canUseColor={canUseColor}` as a new prop, e.g.:

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
          />
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors will appear here because `ExportImport` and `ImageGrid` don't yet accept these props — that's expected until Tasks 3 and 5 are done. Confirm the only errors are about `canImport`/`canUseColor` not existing on those two components' prop types (nothing else).

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git commit -m "feat: compute role in page.tsx and pass capability props down"
```

---

### Task 3: Gate the import (復元) button in `ExportImport.tsx`

**Files:**
- Modify: `app/components/ExportImport.tsx:5` (props), `app/components/ExportImport.tsx:93-105` (restore button)

**Interfaces:**
- Consumes: `canImport` prop passed from `app/page.tsx` (Task 2).
- Produces: no new exports; this closes out the `ExportImport` half of Task 2's type errors.

- [ ] **Step 1: Add the `canImport` prop**

Replace line 5:

```tsx
export default function ExportImport({ folderId, isAdmin }: { folderId?: string; isAdmin?: boolean }) {
```

with:

```tsx
export default function ExportImport({ folderId, isAdmin, canImport }: { folderId?: string; isAdmin?: boolean; canImport?: boolean }) {
```

- [ ] **Step 2: Hide the restore button when `canImport` is false**

Replace lines 93-105:

```tsx
      <label
        className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
        title="バックアップファイルから復元"
      >
        📂 復元
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImport}
        />
      </label>
```

with:

```tsx
      {canImport && (
        <label
          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
          title="バックアップファイルから復元"
        >
          📂 復元
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
        </label>
      )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors mentioning `ExportImport.tsx`

- [ ] **Step 4: Commit**

```bash
git add app/components/ExportImport.tsx
git commit -m "feat: hide restore button for restricted users"
```

---

### Task 4: Enforce role in the API routes (backend)

**Files:**
- Modify: `app/api/admin-backup/route.ts:1,24-30`
- Modify: `app/api/import/route.ts:1,13-18`
- Modify: `app/api/colors/route.ts:1,19-22,37-40,70-73`
- Modify: `app/api/manual-color/route.ts:1,23-28`

**Interfaces:**
- Consumes: `getRole`, `canAccessAdminBackup`, `canImport`, `canUseColorFeatures` from `@/config/permissions` (Task 1).
- Produces: nothing new consumed by other tasks; this task is API-only and independent of Tasks 2/3/5's UI props (can run in parallel with them, but is written after Task 1 in this plan for narrative order).

- [ ] **Step 1: `app/api/admin-backup/route.ts` — replace hardcoded email check**

Add to the imports (top of file, after line 1 `import { auth } from "@/auth";`):

```ts
import { getRole, canAccessAdminBackup } from "@/config/permissions";
```

Replace lines 24-30:

```ts
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (session.user.email.toLowerCase() !== "hinako.nakatani@shintairiku.jp") {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
```

with:

```ts
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (!canAccessAdminBackup(getRole(session.user.email))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
```

- [ ] **Step 2: `app/api/import/route.ts` — block restricted users**

Add to the imports (after line 1 `import { auth } from "@/auth";`):

```ts
import { getRole, canImport } from "@/config/permissions";
```

Replace lines 13-18:

```ts
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const email = session.user.email;
```

with:

```ts
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (!canImport(getRole(session.user.email))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const email = session.user.email;
```

- [ ] **Step 3: `app/api/colors/route.ts` — block restricted users on all methods**

Add to the imports (after line 1 `import { auth } from "@/auth";`):

```ts
import { getRole, canUseColorFeatures } from "@/config/permissions";
```

In `GET` (currently lines 19-22), replace:

```ts
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
```

with:

```ts
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (!canUseColorFeatures(getRole(session.user.email))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
```

Apply the exact same replacement (same before/after snippet) inside `POST` (currently lines 37-40) and inside `PUT` (currently lines 70-73). All three handlers get the identical two-line addition right after their existing login check.

- [ ] **Step 4: `app/api/manual-color/route.ts` — block restricted users**

Add to the imports (after line 1 `import { auth } from "@/auth";`):

```ts
import { getRole, canUseColorFeatures } from "@/config/permissions";
```

Replace lines 24-27:

```ts
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
```

with:

```ts
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }
  if (!canUseColorFeatures(getRole(session.user.email))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in any of the four route files

- [ ] **Step 6: Commit**

```bash
git add app/api/admin-backup/route.ts app/api/import/route.ts app/api/colors/route.ts app/api/manual-color/route.ts
git commit -m "feat: enforce role checks in admin-backup, import, colors, and manual-color API routes"
```

---

### Task 5: Gate color-tab UI in `ImageGrid.tsx`

**Files:**
- Modify: `app/components/ImageGrid.tsx:54-66` (props type + destructuring)
- Modify: `app/components/ImageGrid.tsx:855-877` (color tab row + import button)
- Modify: `app/components/ImageGrid.tsx:964-991` (import panel)
- Modify: `app/components/ImageGrid.tsx:1261-1289` (sidebar color buttons)

**Interfaces:**
- Consumes: `canUseColor` prop passed from `app/page.tsx` (Task 2).
- Produces: nothing new consumed elsewhere; closes out Task 2's remaining type error.

- [ ] **Step 1: Add `canUseColor` to the props type and destructuring**

Replace lines 54-66:

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

export default function ImageGrid({ folders, folderId, initialColors, initialMonths, initialMemos, initialFolderTagCount, initialFolderTags, initialRenameMap, userName }: Props) {
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
};

export default function ImageGrid({ folders, folderId, initialColors, initialMonths, initialMemos, initialFolderTagCount, initialFolderTags, initialRenameMap, userName, canUseColor = true }: Props) {
```

(Default `= true` keeps any other, non-`page.tsx` caller of `ImageGrid` behaving as before if one is ever added — there is currently only one call site, in `app/page.tsx`, which always passes the prop explicitly per Task 2.)

- [ ] **Step 2: Hide the color tab row and the spreadsheet-import button**

Replace lines 855-877:

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

with:

```tsx
          {canUseColor && COLOR_TABS.map(tab => (
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
          {canUseColor && (
            <button
              onClick={() => { setShowImport(v => !v); setImportStatus(""); }}
              className="ml-auto self-center text-xs px-2 py-1 rounded border border-gray-300 hover:border-gray-400 text-gray-500"
            >
              📥 インポート
            </button>
          )}
```

- [ ] **Step 3: Hide the import panel**

Replace line 965 (the panel's opening condition, currently `{showImport && (`) with `{canUseColor && showImport && (`. Full before/after for that one line, in context (lines 964-966):

```tsx
      {/* インポートパネル */}
      {showImport && (
        <div className="mb-4 mt-2 p-4 bg-gray-50 border rounded-lg">
```

becomes:

```tsx
      {/* インポートパネル */}
      {canUseColor && showImport && (
        <div className="mb-4 mt-2 p-4 bg-gray-50 border rounded-lg">
```

- [ ] **Step 4: Hide the sidebar color-assignment buttons**

Replace lines 1261-1289:

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

with:

```tsx
        {canUseColor && COLOR_TABS.map(c => (
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
        {canUseColor && (
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
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors anywhere (this closes out the last error introduced in Task 2)

- [ ] **Step 6: Commit**

```bash
git add app/components/ImageGrid.tsx
git commit -m "feat: hide color tabs, spreadsheet import, and color-assign sidebar for restricted users"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: nothing (terminal task).

- [ ] **Step 1: Full type-check and production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: server starts on `http://localhost:3000` (or the port it prints).

- [ ] **Step 3: Verify the admin role**

Log in with the account listed in `ADMIN_EMAILS` (`hinako.nakatani@shintairiku.jp`). Open a folder. Confirm:
- "📦 全データBK(管理者用)" button is visible in the header
- "📂 復元" button is visible in the header
- Color category tabs (🟥🟦🟩🟪🟨⬛) and "📥 インポート" are visible in the tab row
- "🎨手動着色" button is visible in the header
- Selecting an image shows the color-assignment sidebar with color swatches and "⬜ 色を消す"

- [ ] **Step 4: Verify the general-user role**

Temporarily add a second Google-account email you can log into to neither `ADMIN_EMAILS` nor `RESTRICTED_EMAILS` (or use an account already excluded from both). Log in. Confirm:
- "📦 全データBK(管理者用)" is **not** visible
- "📂 復元", color tabs, "📥 インポート", "🎨手動着色", and the sidebar color buttons are all still visible and functional

- [ ] **Step 5: Verify the restricted-user role**

Edit `config/permissions.ts` locally, add a test email you can log into `RESTRICTED_EMAILS`, restart the dev server, and log in with that account. Confirm:
- "📦 全データBK(管理者用)" and "📂 復元" are **not** visible
- Color category tabs and "📥 インポート" are **not** visible in the tab row ("全て" and "🎲 ランダム選定" remain visible)
- "🎨手動着色" button is **not** visible in the header
- Selecting an image shows the sidebar, but no color swatches or "⬜ 色を消す" button (只 memo/folder-tag buttons if applicable)

- [ ] **Step 6: Verify backend enforcement directly**

While still logged in as the restricted test account, open the browser devtools console and run:

```js
fetch("/api/colors?folderId=SOME_FOLDER_ID").then(r => r.json()).then(console.log)
```

(substitute a real folder ID you have access to). Expected: `{ error: "権限がありません" }` with a 403 status. Repeat for `POST /api/import` and `POST /api/manual-color` (both should also 403).

- [ ] **Step 7: Revert the test email from `config/permissions.ts`**

Remove the test email you added in Step 5 from `RESTRICTED_EMAILS` (keep the file as intended for real production use), then:

```bash
git diff config/permissions.ts
```

Expected: no diff (file matches what Task 1 committed). If there is a diff, discard it:

```bash
git checkout -- config/permissions.ts
```

- [ ] **Step 8: Final commit check**

```bash
git log --oneline -8
git status
```

Expected: clean working tree, and the 5 feature commits from Tasks 1-5 are present on top of the existing history.
