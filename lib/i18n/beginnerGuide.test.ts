import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LOCALES } from "./config";
import { getBeginnerGuideCopy } from "./beginnerGuide";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("every locale provides the complete six-step beginner journey", () => {
  for (const { code } of LOCALES) {
    const copy = getBeginnerGuideCopy(code);
    assert.equal(copy.slides.length, 6);
    assert.ok(copy.onboarding.canPlayTitle.length > 0);
    assert.ok(copy.onboarding.skipRank.length > 0);
    assert.ok(copy.onboarding.openLessons.length > 0);
    assert.ok(copy.scoring.hideNextTime.length > 0);
    assert.ok(copy.scoring.reopen.length > 0);
    for (const slide of copy.slides) {
      assert.ok(slide.title.length > 0);
      assert.ok(slide.body.length > 0);
      assert.ok(slide.note.length > 0);
    }
  }
});

test("registration moves strength selection into the guided dialog", () => {
  const passwordForm = source("components/auth/AuthForm.tsx");
  const oauthForm = source("components/auth/OAuthUsernameForm.tsx");
  const onboarding = source("components/auth/BeginnerOnboardingDialog.tsx");
  assert.doesNotMatch(passwordForm, /auth-strength/);
  assert.doesNotMatch(oauthForm, /auth-strength/);
  assert.match(passwordForm, /BeginnerOnboardingDialog/);
  assert.match(oauthForm, /BeginnerOnboardingDialog/);
  assert.match(onboarding, /KYU_OPTIONS/);
  assert.match(onboarding, /estimate: "unspecified"/);
  assert.match(onboarding, /estimate: "new"/);
});

test("scoring help opens on entry, can be suppressed, and remains manually available", () => {
  const room = source("components/game/GameRoom.tsx");
  const panel = source("components/game/GamePanel.tsx");
  assert.match(room, /previousGame\?\.phase !== "scoring"/);
  assert.match(room, /SCORING_HELP_HIDDEN_PREFIX/);
  assert.match(room, /onHideNextTime/);
  assert.match(panel, /ScoringHelpButton/);
  assert.match(panel, /onShowScoringHelp/);
});
