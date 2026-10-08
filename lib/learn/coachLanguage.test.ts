import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { approvedCoachPhrases, coachRuleMatches, encodeCoachText, decodeCoachTokens, decodeCoachComment, type CoachTokenizer, type PhraseRule } from "./coachLanguage";
import { buildCoachEvidence } from "./coachEvidence";
import { createTrainingPosition, applyTrainingAction } from "./trainingGame";
import { COACH_MODEL, COACH_REASONS } from "./coachModel";

const tokenizer = JSON.parse(readFileSync(new URL("../../assets/coach/tokenizer.json", import.meta.url), "utf8")) as CoachTokenizer;
const before = createTrainingPosition(9);
const played = applyTrainingAction(before, { kind: "play", x: 2, y: 6 });
if (!played.ok) throw new Error("Invalid fixture");
const evidence = buildCoachEvidence(before, played.position,
  { turnNumber: 0, rootInfo: { currentPlayer: "B", visits: 12, scoreLead: 0, winrate: .5 }, moveInfos: [{ move: "C3", order: 0, visits: 10, scoreLead: 0, winrate: .5, pv: [] }] },
  { turnNumber: 1, rootInfo: { currentPlayer: "W", visits: 12, scoreLead: 0, winrate: .5 }, moveInfos: [{ move: "G7", order: 0, visits: 10, scoreLead: 0, winrate: .5, pv: [] }] });

test("all packaged assets match pinned identities and stay below the added 20MB budget", async () => {
  let total = 0;
  for (const [file, hash] of Object.entries(COACH_MODEL.files)) {
    const bytes = await readFile(new URL(`../../assets/coach/${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash); total += bytes.length;
  }
  assert.ok(total < 20_000_000);
});

test("word/byte tokenization round-trips umlauts and exact spaces without added separators", () => {
  assert.equal(tokenizer.type, "word-with-utf8-fallback");
  for (const text of ["Weiß hat eine Freiheit. Gut!", "Äußere Größe: 6 × 9", "Gut gespielt. Dieser Zug passt hier."]) {
    assert.equal(decodeCoachTokens([1, ...encodeCoachText(text, tokenizer.words), 2], tokenizer.words), text);
  }
});

test("phrases fail closed for unknown facts, numbers, human context and board sizes", () => {
  const base: PhraseRule = { quality: "good", facts: ["played:opening_corner"] };
  assert.equal(coachRuleMatches(base, evidence, "opening_corner"), true);
  for (const rule of [{ ...base, quality: "blunder" }, { ...base, facts: ["played:eyes"] }, { ...base, numbers: { captured: 1 } }, { ...base, alternativeNumbers: { lost: 4 } }, { ...base, context: "human-original" }, { ...base, boardSize: 19 }, { ...base, zones: ["right"] }]) {
    assert.equal(coachRuleMatches(rule, evidence, "opening_corner"), false);
  }
  assert.equal(coachRuleMatches(base, evidence, "human_insight"), false);
  const approved = approvedCoachPhrases(tokenizer, evidence);
  assert.ok(approved.length);
  assert.ok(approved.every(p => p.text.length <= 190 && p.text.split(/\s+/).length <= 30));
  assert.ok(!approved.some(p => /echte[n]? Augen|Leiter|gegnerischen Stein geschlagen/.test(p.text)));
});

test("decoder uses learned token probabilities inside the allowed grammar and returns no invented fallback", async () => {
  const target = "Guter Zug.";
  const bank: CoachTokenizer = { ...tokenizer, phrases: { good: [target] }, phraseRules: { [target]: [{ quality: "good", facts: ["played:quiet_good"] }] } };
  let calls = 0;
  const infer = async (prefixes: number[][]) => {
    calls++;
    const text = new Float32Array(prefixes.length * prefixes[0].length * 2048);
    const reason = new Float32Array(20); reason[COACH_REASONS.indexOf("good")] = 10;
    return { text, reason, vocabulary: 2048 };
  };
  assert.deepEqual(await decodeCoachComment(bank, evidence, infer), { text: target, reason: "good" });
  assert.ok(calls > 2);
  calls = 0;
  assert.equal(await decodeCoachComment({ ...bank, phraseRules: {} }, evidence, infer), null);
  assert.equal(calls, 0);
});
