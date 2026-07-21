export const HAS_PERSON = ["人物あり", "人物なし"];
export const SCENE = ["屋内", "屋外"];
export const SHOT = ["寄り", "引き"];

export const isTagged = (label) => Boolean(label && typeof label.scene === "string" && label.scene.length > 0);

export const emptyLabel = () => ({ bigTheme: "", specificTheme: "", tags: [] });

export function validateLabel(label) {
  const errors = [];
  const inSet = (v, set, name) => { if (v !== undefined && !set.includes(v)) errors.push(`${name} は ${set.join("/")} のいずれか`); };
  inSet(label.hasPerson, HAS_PERSON, "hasPerson");
  inSet(label.scene, SCENE, "scene");
  inSet(label.shot, SHOT, "shot");
  for (const f of ["subjects", "freeTags", "tags"]) {
    if (label[f] !== undefined && !Array.isArray(label[f])) errors.push(`${f} は配列`);
  }
  return { ok: errors.length === 0, errors };
}
