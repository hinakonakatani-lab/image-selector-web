export function filterByCriteria(items, criteria = {}) {
  const c = criteria;
  return items.filter(({ label = {} }) => {
    if (c.scene && label.scene !== c.scene) return false;
    if (c.hasPerson && label.hasPerson !== c.hasPerson) return false;
    if (c.shot && label.shot !== c.shot) return false;
    if (c.place && !(label.place ?? "").includes(c.place)) return false;
    if (c.subject && !(label.subjects ?? []).some((s) => s.includes(c.subject))) return false;
    return true;
  });
}
