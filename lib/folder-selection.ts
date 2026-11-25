export type SelectionEntry = { fileId: string; renameName: string | null };

// folderTags({fileId: 本目番号}) と renameMap({fileId: カスタム名}) を、
// 本目番号(文字列キー)ごとの一覧にまとめる。各一覧は fileId 昇順。
// renameMap にだけ載っている fileId は含めない。
export function groupByNumber(
  folderTags: Record<string, number>,
  renameMap: Record<string, string>
): Record<string, SelectionEntry[]> {
  const grouped: Record<string, SelectionEntry[]> = {};
  for (const fileId of Object.keys(folderTags).sort()) {
    const key = String(folderTags[fileId]);
    (grouped[key] ??= []).push({ fileId, renameName: renameMap[fileId] || null });
  }
  return grouped;
}

// APIの応答本体。folderTags のキー自体が無い(null)ときは found:false にして、
// 「フォルダIDの誤り」と「そのIDに選定はあるが該当の本目が無い」を呼び出し側が区別できるようにする。
export function selectionPayload(
  folderId: string,
  folderTags: Record<string, number> | null,
  renameMap: Record<string, string> | null
) {
  return {
    folderId,
    found: folderTags !== null,
    selections: groupByNumber(folderTags || {}, renameMap || {}),
  };
}
