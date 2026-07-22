// scripts/list-images.mjs
// usage: node scripts/list-images.mjs <rootFolderId>
import { google } from "googleapis";
import { splitChildren, groupImagesByLeaf } from "./lib/drive-tree.mjs";
import { getGoogleCreds } from "./lib/api-config.mjs";

function driveClient() {
  // Google OAuth（drive.readonly）認証情報はキーチェーンから取得（環境変数に平文で置かない）
  const { clientId, clientSecret, refreshToken } = getGoogleCreds();
  const o = new google.auth.OAuth2(clientId, clientSecret);
  o.setCredentials({ refresh_token: refreshToken });
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
