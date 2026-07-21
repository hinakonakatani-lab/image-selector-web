// usage: node scripts/read-labels.mjs   → 全 labels:shared:* を JSON 配列で出力
import { makeClient, readAllLabels } from "./lib/redis.mjs";
const items = await readAllLabels(makeClient());
process.stdout.write(JSON.stringify(items, null, 2));
