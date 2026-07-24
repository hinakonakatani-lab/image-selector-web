import { readFileSync } from "node:fs";
import { join } from "node:path";

export function expandTerm(term, groups = []) {
  if (!term) return [];
  const results = new Set([term]);
  for (const group of groups) {
    const members = [group.canonical, ...(group.synonyms ?? [])];
    if (members.includes(term)) {
      for (const m of members) results.add(m);
    }
  }
  return [...results];
}

export function loadSynonymGroups(path = join(process.cwd(), "config", "tag-synonyms.json")) {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
