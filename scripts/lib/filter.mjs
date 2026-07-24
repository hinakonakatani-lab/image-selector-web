import { expandTerm } from "./synonyms.mjs";

function matchesAnyTerm(values, terms, groups) {
  return terms.some((term) =>
    expandTerm(term, groups).some((variant) => values.some((value) => value.includes(variant)))
  );
}

export function filterByCriteria(items, criteria = {}, synonymGroups = []) {
  const c = criteria;
  return items.filter(({ label = {} }) => {
    if (c.scene && label.scene !== c.scene) return false;
    if (c.hasPerson && label.hasPerson !== c.hasPerson) return false;
    if (c.shot && label.shot !== c.shot) return false;
    if (c.place?.length && !matchesAnyTerm([label.place ?? ""], c.place, synonymGroups)) return false;
    if (c.subjects?.length && !matchesAnyTerm(label.subjects ?? [], c.subjects, synonymGroups)) return false;
    if (c.freeTags?.length && !matchesAnyTerm(label.freeTags ?? [], c.freeTags, synonymGroups)) return false;
    return true;
  });
}
