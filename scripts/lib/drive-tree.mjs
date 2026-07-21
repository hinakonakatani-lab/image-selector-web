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
