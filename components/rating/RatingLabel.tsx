import type { Locale } from "@/lib/i18n/config";
import { presentRating, type RatingDisplayPreference } from "@/lib/rating/rankPolicy";

export function RatingLabel({
  rating,
  preference,
  locale,
}: {
  rating: number;
  preference: RatingDisplayPreference;
  locale: Locale;
}) {
  const presentation = presentRating(rating, preference, locale === "de" ? "de" : "en");
  return (
    <span className="rating-label">
      <strong>{presentation.primaryLabel}</strong>
      {presentation.secondaryLabel ? <small>{presentation.secondaryLabel}</small> : null}
    </span>
  );
}
