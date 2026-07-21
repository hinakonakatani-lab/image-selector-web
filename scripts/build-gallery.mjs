import { writeFileSync } from "node:fs";
import { renderGallery } from "./lib/gallery.mjs";

const [theme, outPath] = [process.argv[2], process.argv[3]];
if (!theme || !outPath) {
  console.error("theme と outHtmlPath が必要です");
  process.exit(1);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const tiles = JSON.parse(input);
writeFileSync(outPath, renderGallery(theme, tiles));
console.log(`OK: ${tiles.length} 件を ${outPath} に出力`);
