import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RatingLabel } from "../../components/rating/RatingLabel";

test("provisional ratings use a compact accessible question-mark marker", () => {
  const provisional = renderToStaticMarkup(createElement(RatingLabel, {
    isProvisional: true,
    locale: "de",
    preference: "both",
    provisionalLabel: "Vorläufig",
    rating: 1200,
  }));
  const established = renderToStaticMarkup(createElement(RatingLabel, {
    locale: "de",
    preference: "both",
    provisionalLabel: "Vorläufig",
    rating: 1200,
  }));

  assert.match(provisional, /16\. Kyu · 1200/);
  assert.match(provisional, /aria-label="Vorläufig"/);
  assert.match(provisional, /class="rating-label__provisional"[^>]*>\?<\/sup>/);
  assert.doesNotMatch(established, /rating-label__provisional/);
});
