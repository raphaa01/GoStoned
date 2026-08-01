import type { Locale } from "@/lib/i18n/config";
import { presentRating, type RatingDisplayPreference } from "@/lib/rating/rankPolicy";

export function RatingLabel({
  rating,
  preference,
  locale,
  variant = "default",
}: {
  rating: number;
  preference: RatingDisplayPreference;
  locale: Locale;
  variant?: "default" | "compact" | "hero";
}) {
  const presentation = presentRating(rating, preference, locale === "de" ? "de" : "en");
  return (
    <span className={`rating-label rating-label--${variant}`}>
      <strong>{presentation.primaryLabel}</strong>
      {presentation.secondaryLabel ? <small>{presentation.secondaryLabel}</small> : null}
    </span>
  );
}
