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
