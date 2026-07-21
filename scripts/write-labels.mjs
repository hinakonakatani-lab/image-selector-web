// usage: node scripts/write-labels.mjs <folderId>  (stdin に {fileId: label} JSON)
import { makeClient, writeLabels } from "./lib/redis.mjs";
const folderId = process.argv[2];
if (!folderId) { console.error("folderId が必要です"); process.exit(1); }
let input = "";
for await (const chunk of process.stdin) input += chunk;
const incoming = JSON.parse(input);
await writeLabels(makeClient(), folderId, incoming);
console.log(`OK: ${Object.keys(incoming).length} 件を labels:shared:${folderId} に書込`);
