import { test } from "node:test";
import assert from "node:assert/strict";
import { isTagged, validateLabel, emptyLabel, HAS_PERSON, SCENE, SHOT } from "./tag-schema.mjs";

test("isTagged は scene 有無で判定", () => {
  assert.equal(isTagged(undefined), false);
  assert.equal(isTagged({ bigTheme: "" }), false);
  assert.equal(isTagged({ scene: "屋内" }), true);
});

test("validateLabel は固定軸の値域を検証", () => {
  const ok = validateLabel({ hasPerson: "人物なし", scene: "屋内", shot: "引き", place: "和室", subjects: ["畳"], freeTags: [] });
  assert.equal(ok.ok, true);
  const bad = validateLabel({ scene: "宇宙", subjects: "畳" });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 2);
});

test("固定軸の候補", () => {
  assert.deepEqual(HAS_PERSON, ["人物あり","人物なし"]);
  assert.deepEqual(SCENE, ["屋内","屋外"]);
  assert.deepEqual(SHOT, ["寄り","引き"]);
});

test("emptyLabel は既存フィールドを空で持つ", () => {
  const e = emptyLabel();
  assert.equal(e.bigTheme, "");
  assert.deepEqual(e.tags, []);
});
