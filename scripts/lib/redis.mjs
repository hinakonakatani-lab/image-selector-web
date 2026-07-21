import { Redis } from "@upstash/redis";
import { labelsKey, LABELS_SCAN_PATTERN, isScanComplete } from "./keys.mjs";

export const mergeLabels = (existing = {}, incoming = {}) => ({ ...existing, ...incoming });

export function makeClient() {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN が未設定です");
  return new Redis({ url, token });
}

export async function readAllLabels(client) {
  const out = [];
  let cursor = "0";
  do {
    const [next, keys] = await client.scan(cursor, { match: LABELS_SCAN_PATTERN, count: 100 });
    cursor = next;
    for (const key of keys) {
      const folderId = key.slice("labels:shared:".length);
      const map = (await client.get(key)) || {};
      for (const [fileId, label] of Object.entries(map)) out.push({ folderId, fileId, label });
    }
  } while (!isScanComplete(cursor));
  return out;
}

export async function writeLabels(client, folderId, incoming) {
  const key = labelsKey(folderId);
  const existing = (await client.get(key)) || {};
  await client.set(key, mergeLabels(existing, incoming));
}
