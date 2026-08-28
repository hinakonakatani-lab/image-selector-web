import { test } from "node:test";
import assert from "node:assert/strict";
import { walkFolders, type DriveLike } from "./drive-walk.ts";

type FakeFile = {
  id?: string | null;
  name?: string | null;
  thumbnailLink?: string | null;
  webViewLink?: string | null;
};
type FakeNode = { name: string; images?: FakeFile[]; folders?: FakeFile[] };

// フォルダ構造を宣言的に書けるフェイクDrive。
// 各呼び出しの同時実行数を記録するので、逐次か並列かをテストから観測できる。
function fakeDrive(tree: Record<string, FakeNode>, { delayMs = 0 } = {}) {
  const calls = { get: 0, list: 0 };
  const queries: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const settle = async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    inFlight--;
  };

  const drive: DriveLike = {
    files: {
      async get({ fileId }) {
        calls.get++;
        await settle();
        return { data: { name: tree[fileId]?.name ?? fileId } };
      },
      async list({ q }) {
        calls.list++;
        queries.push(q);
        await settle();
        const parent = q.match(/'([^']+)' in parents/)![1];
        const node = tree[parent];
        const wantsFolders = q.includes("application/vnd.google-apps.folder");
        const files = (wantsFolders ? node?.folders : node?.images) ?? [];
        return { data: { files } };
      },
    },
  };
  // maxInFlight は走査後に読むので、分割代入で固定されないよう関数で返す。
  return { drive, calls, queries, maxInFlight: () => maxInFlight };
}

const img = (id: string, thumb = `https://lh3.example/${id}=s220`) => ({
  id,
  name: `${id}.jpg`,
  thumbnailLink: thumb,
  webViewLink: `https://drive.example/${id}`,
});

test("ルート直下の画像をルート名のパスで返す", async () => {
  const { drive } = fakeDrive({ root: { name: "素材", images: [img("a")] } });

  const folders = await walkFolders(drive, "root");

  assert.equal(folders.length, 1);
  assert.equal(folders[0].id, "root");
  assert.equal(folders[0].name, "素材");
  assert.equal(folders[0].path, "素材");
  assert.equal(folders[0].images.length, 1);
  assert.equal(folders[0].images[0].id, "a");
  assert.equal(folders[0].images[0].name, "a.jpg");
  assert.equal(folders[0].images[0].webViewLink, "https://drive.example/a");
});

test("サムネイルURLの=s220を=s300に置き換える", async () => {
  const { drive } = fakeDrive({ root: { name: "素材", images: [img("a")] } });

  const folders = await walkFolders(drive, "root");

  assert.equal(folders[0].images[0].thumbnailUrl, "https://lh3.example/a=s300");
});

test("thumbnailLinkが無い画像は空文字のURLになる", async () => {
  const { drive } = fakeDrive({
    root: { name: "素材", images: [{ id: "a", name: "a.jpg", webViewLink: "w" }] },
  });

  const folders = await walkFolders(drive, "root");

  assert.equal(folders[0].images[0].thumbnailUrl, "");
});

test("サブフォルダを再帰的に辿り、パスを「親 / 子」で連結する", async () => {
  const { drive } = fakeDrive({
    root: { name: "素材", images: [img("a")], folders: [{ id: "sub", name: "玄関" }] },
    sub: { name: "玄関", images: [img("b")], folders: [{ id: "deep", name: "夜景" }] },
    deep: { name: "夜景", images: [img("c")] },
  });

  const folders = await walkFolders(drive, "root");

  assert.deepEqual(
    folders.map((f) => f.path),
    ["素材", "素材 / 玄関", "素材 / 玄関 / 夜景"]
  );
});

test("画像が0枚のフォルダは結果に含めないが、その下は辿る", async () => {
  const { drive } = fakeDrive({
    root: { name: "素材", folders: [{ id: "empty", name: "空" }] },
    empty: { name: "空", images: [], folders: [{ id: "deep", name: "中身あり" }] },
    deep: { name: "中身あり", images: [img("c")] },
  });

  const folders = await walkFolders(drive, "root");

  assert.deepEqual(
    folders.map((f) => f.path),
    ["素材 / 空 / 中身あり"]
  );
});

test("兄弟フォルダは宣言順（深さ優先）で並ぶ", async () => {
  const { drive } = fakeDrive({
    root: {
      name: "素材",
      folders: [
        { id: "s1", name: "1月" },
        { id: "s2", name: "2月" },
      ],
    },
    s1: { name: "1月", images: [img("a")], folders: [{ id: "s1a", name: "上旬" }] },
    s1a: { name: "上旬", images: [img("b")] },
    s2: { name: "2月", images: [img("c")] },
  });

  const folders = await walkFolders(drive, "root");

  assert.deepEqual(
    folders.map((f) => f.path),
    ["素材 / 1月", "素材 / 1月 / 上旬", "素材 / 2月"]
  );
});

test("画像の検索クエリはPhotoshopファイルとゴミ箱を除外する", async () => {
  const { drive, queries } = fakeDrive({ root: { name: "素材", images: [img("a")] } });

  await walkFolders(drive, "root");

  const imageQuery = queries.find((q) => !q.includes("application/vnd.google-apps.folder"))!;
  assert.match(imageQuery, /mimeType contains 'image\//);
  assert.match(imageQuery, /not mimeType = 'image\/vnd\.adobe\.photoshop'/);
  assert.match(imageQuery, /trashed = false/);
});

test("フォルダ名は親の一覧から引き継ぐので files.get はルートの1回だけ", async () => {
  const { drive, calls } = fakeDrive({
    root: { name: "素材", folders: [{ id: "s1", name: "1月" }, { id: "s2", name: "2月" }] },
    s1: { name: "1月", images: [img("a")] },
    s2: { name: "2月", images: [img("b")] },
  });

  await walkFolders(drive, "root");

  assert.equal(calls.get, 1);
});

test("同階層の画像一覧とサブフォルダ一覧、および兄弟フォルダを並列に取得する", async () => {
  // 3つの兄弟フォルダ。逐次なら同時実行数は常に1になる。
  const { drive, maxInFlight } = fakeDrive(
    {
      root: {
        name: "素材",
        folders: [
          { id: "s1", name: "1月" },
          { id: "s2", name: "2月" },
          { id: "s3", name: "3月" },
        ],
      },
      s1: { name: "1月", images: [img("a")] },
      s2: { name: "2月", images: [img("b")] },
      s3: { name: "3月", images: [img("c")] },
    },
    { delayMs: 20 }
  );

  await walkFolders(drive, "root");

  // 兄弟3フォルダ × (画像一覧 + サブフォルダ一覧) が重なるので、
  // 逐次実装(=1)では絶対に届かない値になる。
  assert.ok(
    maxInFlight() >= 6,
    `並列に取得できていない（同時実行数の最大 = ${maxInFlight()}、期待 >= 6）`
  );
});

test("深い階層でも逐次より大幅に速い（所要時間は深さに比例、フォルダ数には比例しない）", async () => {
  // 20個の兄弟フォルダ。1回20msなので逐次なら 20*2*20ms = 800ms 以上かかる。
  const tree: Record<string, FakeNode> = { root: { name: "素材", folders: [] } };
  for (let i = 0; i < 20; i++) {
    tree.root.folders!.push({ id: `s${i}`, name: `${i}月` });
    tree[`s${i}`] = { name: `${i}月`, images: [img(`img${i}`)] };
  }
  const { drive } = fakeDrive(tree, { delayMs: 20 });

  const started = Date.now();
  const folders = await walkFolders(drive, "root");
  const elapsed = Date.now() - started;

  assert.equal(folders.length, 20);
  assert.ok(elapsed < 300, `並列化されていない（${elapsed}ms かかった、期待 < 300ms）`);
});
