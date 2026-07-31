// usage: node scripts/read-colors.mjs   → 全 colors:shared:* を JSON 配列で出力（読み取り専用）
import { getBaseUrl, getToken } from "./lib/api-config.mjs";
import { buildReadRequest, parseItemsResponse } from "./lib/colors-api.mjs";

const { url, options } = buildReadRequest(getBaseUrl(), getToken());
const res = await fetch(url, options);
if (!res.ok) throw new Error(`読取API失敗: ${res.status} ${await res.text()}`);
const items = parseItemsResponse(await res.json());
process.stdout.write(JSON.stringify(items, null, 2));
