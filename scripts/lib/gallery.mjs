const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function tile(t) {
  const tags = [t.label?.scene, t.label?.place, t.label?.shot, ...(t.label?.subjects ?? [])].filter(Boolean).map(esc).join(" / ");
  return `<figure class="tile">
  <a href="${esc(t.viewUrl)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(t.thumbPath)}" alt="${esc(t.title)}"></a>
  <figcaption><div class="ttl">${esc(t.title)}</div><div class="tags">${tags}</div></figcaption>
</figure>`;
}

export function renderGallery(theme, tiles) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(theme)} — 画像収集結果</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#fafafa;color:#222}
  h1{font-size:18px}.count{color:#666;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
  .tile{margin:0;background:#fff;border:1px solid #eee;border-radius:10px;overflow:hidden}
  .tile img{width:100%;height:170px;object-fit:cover;display:block}
  figcaption{padding:8px}.ttl{font-size:12px;font-weight:600}.tags{font-size:11px;color:#666;margin-top:4px}
</style></head>
<body>
<h1>テーマ: ${esc(theme)}</h1>
<div class="count">${tiles.length} 件</div>
<div class="grid">
${tiles.map(tile).join("\n")}
</div>
</body></html>`;
}
