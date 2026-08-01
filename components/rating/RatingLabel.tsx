import type { Locale } from "@/lib/i18n/config";
import { presentRating, type RatingDisplayPreference } from "@/lib/rating/rankPolicy";

export function RatingLabel({
  rating,
  preference,
  locale,
  variant = "default",
  isProvisional = false,
  provisionalLabel,
}: {
  rating: number;
  preference: RatingDisplayPreference;
  locale: Locale;
  variant?: "default" | "compact" | "hero";
  isProvisional?: boolean;
  provisionalLabel?: string;
}) {
  const presentation = presentRating(rating, preference, locale === "de" ? "de" : "en");
  return (
    <span className={`rating-label rating-label--${variant}`}>
      <span className="rating-label__primary">
        <strong>{presentation.primaryLabel}</strong>
        {isProvisional ? (
          <sup
            aria-label={provisionalLabel}
            className="rating-label__provisional"
            title={provisionalLabel}
          >
            ?
          </sup>
        ) : null}
      </span>
      {presentation.secondaryLabel ? <small>{presentation.secondaryLabel}</small> : null}
    </span>
  );
}
