export function collectVocab(items, field) {
  const m = new Map();
  const bump = (v) => { if (v) m.set(v, (m.get(v) ?? 0) + 1); };
  for (const { label = {} } of items) {
    const val = label[field];
    if (Array.isArray(val)) val.forEach(bump);
    else bump(val);
  }
  return m;
}

export function applyMerges(items, field, mergeMap) {
  const map = (v) => (v in mergeMap ? mergeMap[v] : v);
  return items.map((it) => {
    const label = { ...(it.label ?? {}) };
    const val = label[field];
    if (Array.isArray(val)) label[field] = [...new Set(val.map(map))];
    else if (val !== undefined) label[field] = map(val);
    return { ...it, label };
  });
}
