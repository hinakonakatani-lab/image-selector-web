// usage: node scripts/read-labels.mjs   → 全 labels:shared:* を JSON 配列で出力
import { readAllLabels } from "./lib/redis.mjs";
const items = await readAllLabels();
process.stdout.write(JSON.stringify(items, null, 2));
