import type { CoachEvidence } from "./coachEvidence";
import { COACH_REASONS, type CoachReason } from "./coachModel";

export type PhraseRule = {
  quality: string; qualities?: string[]; facts: string[];
  numbers?: Record<string, number>; alternativeNumbers?: Record<string, number>;
  zones?: string[]; context?: string; boardSize?: number;
};
export type CoachTokenizer = {
  type: string; vocabSize: number; words: string[];
  phrases: Record<string, string[]>; phraseRules: Record<string, PhraseRule[]>;
  manualExamples: Record<string, string[]>;
};
export type ApprovedPhrase = { text: string; reason: CoachReason; tokens: number[] };

export function encodeCoachText(text: string, words: readonly string[]): number[] {
  const vocabulary = new Map(words.map((word, i) => [word, i + 259]));
  const encoder = new TextEncoder();
  // Preserve every space and punctuation byte: word tokens add no whitespace.
  return (text.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_]+/gu) ?? []).flatMap(part => {
    const token = vocabulary.get(part);
    return token !== undefined ? [token] : [...encoder.encode(part)].map(b => b + 3);
  });
}

export function decodeCoachTokens(tokens: readonly number[], words: readonly string[]): string {
  const encoder = new TextEncoder();
  const bytes = tokens.flatMap(t => t >= 259 ? [...encoder.encode(words[t - 259] ?? "")] : t >= 3 && t <= 258 ? [t - 3] : []);
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
}

export function coachRuleMatches(rule: PhraseRule, evidence: CoachEvidence, reason: CoachReason): boolean {
  // Context-bound human/teacher corrections are not general strategic facts.
  if (reason === "human_insight" || rule.context || !Array.isArray(rule.facts)
    || Object.keys(rule).some(k => !["quality", "qualities", "facts", "numbers", "alternativeNumbers", "zones", "context", "boardSize"].includes(k))) return false;
  if (!(rule.qualities ? rule.qualities.includes(evidence.judgement) : rule.quality === evidence.judgement)) return false;
  if (!rule.facts.every(f => evidence.facts.includes(f))) return false;
  if (rule.boardSize !== undefined && rule.boardSize !== evidence.size) return false;
  for (const [name, stats] of [["numbers", evidence.numbers], ["alternativeNumbers", evidence.alternativeNumbers]] as const) {
    const bindings = rule[name];
    if (bindings && Object.entries(bindings).some(([k, v]) => !(k in stats) || stats[k as keyof typeof stats] !== v)) return false;
  }
  if (rule.zones) {
    const marks = evidence.marks[reason] ?? [];
    const zones = new Set(marks.flatMap(p => [
      ["top", "middle", "bottom"][Math.min(2, Math.floor(p.y * 3 / evidence.size))],
      ["left", "centre", "right"][Math.min(2, Math.floor(p.x * 3 / evidence.size))],
    ]));
    if (!rule.zones.every(zone => zones.has(zone))) return false;
  }
  return true;
}

function consistentWording(text: string, evidence: CoachEvidence, reason: CoachReason): boolean {
  // Additional guards for missing number bindings in this pilot's sentence bank.
  if (/Du bedroht\b|\bMotorzug\b|WÜRDE/.test(text)) return false;
  if (reason === "capture" && /gegnerischen Stein\b|gegnerische[nr]? Stein[s]?\b/.test(text) && evidence.numbers.captured !== 1) return false;
  if (/von zwei auf drei/.test(text) && !(evidence.numbers.libertiesBefore === 2 && evidence.numbers.libertiesAfter === 3)) return false;
  if (/sechs Freiheiten statt einer/.test(text) && !(evidence.numbers.libertiesBefore === 1 && evidence.numbers.libertiesAfter === 6)) return false;
  // A physical benefit doesn't make a bad overall move a "good move".
  if (evidence.judgement !== "good" && /\bGut\b|\bGuter Zug\b|\bGut gespielt\b/.test(text)) return false;
  return true;
}

export function approvedCoachPhrases(tokenizer: CoachTokenizer, evidence: CoachEvidence): ApprovedPhrase[] {
  const result: ApprovedPhrase[] = [];
  for (const reason of evidence.reasons) {
    if (!COACH_REASONS.includes(reason) || reason === "human_insight") continue;
    for (const text of tokenizer.phrases[reason] ?? []) {
      if (!text || text.length > 190 || text.trim().split(/\s+/u).length > 30 || !consistentWording(text, evidence, reason)) continue;
      const rules = tokenizer.phraseRules[text];
      if (!rules?.some(rule => coachRuleMatches(rule, evidence, reason))) continue;
      const tokens = [...encodeCoachText(text, tokenizer.words), 2];
      if (tokens.length + 1 > 384) continue;
      result.push({ text, reason, tokens });
    }
  }
  return result;
}

export type CoachLogits = { text: Float32Array; reason: Float32Array; vocabulary: number };
export type CoachInference = (prefixes: number[][], reason: number) => Promise<CoachLogits>;
type Trie = { children: Map<number, Trie>; text?: string };

function logProbability(logits: Float32Array, start: number, size: number, token: number): number {
  let maximum = -Infinity;
  for (let i = 0; i < size; i++) maximum = Math.max(maximum, logits[start + i]);
  let sum = 0;
  for (let i = 0; i < size; i++) sum += Math.exp(logits[start + i] - maximum);
  return logits[start + token] - maximum - Math.log(sum);
}

export async function decodeCoachComment(tokenizer: CoachTokenizer, evidence: CoachEvidence, infer: CoachInference, budgetMs = 1800): Promise<{ text: string; reason: CoachReason } | null> {
  const approved = approvedCoachPhrases(tokenizer, evidence);
  if (!approved.length) return null;
  const start = performance.now();
  const initial = await infer([[1]], 0);
  const allowedReasons = [...new Set(approved.map(p => p.reason))];
  const reason = allowedReasons.sort((a, b) => initial.reason[COACH_REASONS.indexOf(b)] - initial.reason[COACH_REASONS.indexOf(a)])[0];
  const tree: Trie = { children: new Map() };
  for (const phrase of approved.filter(p => p.reason === reason)) {
    let node = tree;
    for (const token of phrase.tokens) {
      if (!node.children.has(token)) node.children.set(token, { children: new Map() });
      node = node.children.get(token)!;
    }
    node.text = phrase.text;
  }
  let beams = [{ tokens: [1], node: tree, score: 0 }];
  const complete: { text: string; score: number; length: number }[] = [];
  // Real token-wise constrained beam search; no priority-template or random text.
  for (let depth = 0; depth < 383 && beams.length && performance.now() - start < budgetMs; depth++) {
    const output = await infer(beams.map(b => b.tokens), COACH_REASONS.indexOf(reason));
    const next: typeof beams = [];
    beams.forEach((beam, batch) => {
      const offset = (batch * beam.tokens.length + beam.tokens.length - 1) * output.vocabulary;
      for (const [token, node] of beam.node.children) {
        const score = beam.score + logProbability(output.text, offset, output.vocabulary, token);
        if (node.text) complete.push({ text: node.text, score, length: beam.tokens.length });
        else next.push({ tokens: [...beam.tokens, token], node, score });
      }
    });
    beams = next.sort((a, b) => b.score - a.score).slice(0, 4);
  }
  const selected = complete.sort((a, b) => b.score / b.length ** .7 - a.score / a.length ** .7)[0];
  return selected ? { text: selected.text, reason } : null;
}
