import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const PREFIX = "labels:shared:";

export type SharedLabel = {
  hasPerson?: "人物あり" | "人物なし";
  scene?: "屋内" | "屋外";
  shot?: "寄り" | "引き";
  place?: string;
  subjects?: string[];
  freeTags?: string[];
};

export type SharedLabelItem = {
  folderId: string;
  fileId: string;
  label: SharedLabel;
};

export async function readLeafLabels(leafIds: string[]): Promise<SharedLabelItem[]> {
  const items: SharedLabelItem[] = [];
  const results = await Promise.all(
    leafIds.map((leafId) => kv.get<Record<string, SharedLabel>>(`${PREFIX}${leafId}`))
  );
  leafIds.forEach((leafId, i) => {
    const map = results[i] || {};
    for (const [fileId, label] of Object.entries(map)) {
      items.push({ folderId: leafId, fileId, label });
    }
  });
  return items;
}
