import assert from "node:assert/strict";
import test from "node:test";
import { chapterOneCopy } from "@/lib/learn/chapterOne";
import { en } from "./catalogs/en";
import { ky } from "./catalogs/ky";
import { getFriendsCopy } from "./friends";
import { getPrivacyCopy } from "./privacy";

function stringLeaves(value: unknown, path = ""): Map<string, string> {
  const leaves = new Map<string, string>();
  if (typeof value === "string") {
    leaves.set(path, value);
    return leaves;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return leaves;
  for (const [key, child] of Object.entries(value)) {
    for (const [childPath, text] of stringLeaves(child, path ? `${path}.${key}` : key)) {
      leaves.set(childPath, text);
    }
  }
  return leaves;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{[^}]+\}/g)].map(([token]) => token).sort();
}

test("Kyrgyz covers every main dictionary string and preserves interpolation tokens", () => {
  const english = stringLeaves(en);
  const kyrgyz = stringLeaves(ky);
  assert.deepEqual([...kyrgyz.keys()].sort(), [...english.keys()].sort());

  let translated = 0;
  for (const [path, source] of english) {
    const target = kyrgyz.get(path);
    assert.ok(target?.trim(), path);
    if (target === undefined) throw new Error(`Missing Kyrgyz copy at ${path}`);
    assert.deepEqual(placeholders(target), placeholders(source), path);
    if (target !== source) translated += 1;
  }
  assert.ok(translated > english.size * 0.9);
});

test("Kyrgyz account, learning, friends, and privacy pages use Kyrgyz copy", () => {
  const friends = getFriendsCopy("ky");
  const chapter = chapterOneCopy("ky");
  const privacy = getPrivacyCopy("ky");

  assert.equal(friends.nav, "Достор");
  assert.equal(friends.boardSize, "Тактанын өлчөмү");
  assert.match(chapter.kicker, /Башталгыч/);
  assert.match(chapter.lessons.capture.instruction, /[А-Яа-яӨөҮүҢң]/);
  assert.equal(privacy.sections.length, 12);
  assert.match(privacy.title, /Купуялык/);
  assert.ok(privacy.sections.every((section) => (
    /[А-Яа-яӨөҮүҢң]/.test([section.title, ...section.paragraphs, ...section.items].join(" "))
  )));
});
