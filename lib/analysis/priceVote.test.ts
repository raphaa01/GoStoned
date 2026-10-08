import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ANALYSIS_PRICE_OPTIONS,
  parseAnalysisPriceVote,
} from "./priceVote";

const migration = readFileSync(
  new URL("../../db/migrations/048_analysis_price_votes.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../../db/schema.sql", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../app/api/analysis-price-vote/route.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("./priceVoteService.ts", import.meta.url),
  "utf8",
);
const review = readFileSync(
  new URL("../../components/review/AnalysisReview.tsx", import.meta.url),
  "utf8",
);

test("accepts only the offered monthly prices", () => {
  for (const monthlyPriceEur of ANALYSIS_PRICE_OPTIONS) {
    assert.equal(parseAnalysisPriceVote({ monthlyPriceEur }), monthlyPriceEur);
  }
  for (const candidate of [
    null,
    [],
    { monthlyPriceEur: 4 },
    { monthlyPriceEur: "5" },
    { monthlyPriceEur: 5, extra: true },
    {},
  ]) {
    assert.throws(() => parseAnalysisPriceVote(candidate), TypeError);
  }
});

test("stores one private vote per account and deletes it with the account", () => {
  assert.match(migration, /user_id UUID PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /CHECK \(monthly_price_eur IN \(3, 5, 8, 12\)\)/);
  assert.match(migration, /ALTER TABLE analysis_price_votes ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON analysis_price_votes FROM (?:PUBLIC|anon|authenticated)/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON analysis_price_votes TO gostone_app/);
  assert.ok(schema.includes(migration.trim()), "db/schema.sql must include migration 048 exactly");
});

test("updates an existing account vote instead of creating duplicates", () => {
  assert.match(service, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(service, /updated_at = statement_timestamp\(\)/);
  assert.match(service, /RETURNING monthly_price_eur/);
});

test("protects the vote API and binds responses to the active player", () => {
  assert.match(route, /assertAuthMutationRequest\(request, \{ requireJson: true \}\)/);
  assert.match(route, /assertExpectedPlayer\(request, user\.playerKey\)/);
  assert.match(route, /readBoundedJsonObject\(request/);
  assert.match(route, /consumePolicyRateLimit\(request, RATE_LIMIT_POLICIES\.profileMutation/);
  assert.match(route, /actor: user\.playerKey/);
});

test("the analysis limit screen loads and persists the selected vote", () => {
  assert.match(review, /fetch\("\/api\/analysis-price-vote"/);
  assert.match(review, /method: "POST"/);
  assert.match(review, /body: JSON\.stringify\(\{ monthlyPriceEur \}\)/);
  assert.match(review, /assertResponseActor\(body\.actor, playerKey\)/);
  assert.match(review, /supportPriceSaved \? <small>/);
});
