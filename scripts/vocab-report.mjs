// usage: node scripts/vocab-report.mjs <field>   field: place|subjects|freeTags
import { makeClient, readAllLabels } from "./lib/redis.mjs";
import { collectVocab } from "./lib/vocab.mjs";
const field = process.argv[2] || "place";
const items = await readAllLabels(makeClient());
const v = collectVocab(items, field);
const sorted = [...v.entries()].sort((a, b) => b[1] - a[1]);
process.stdout.write(JSON.stringify(sorted, null, 2));
