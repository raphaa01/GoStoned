export const ANALYSIS_PRICE_OPTIONS = [3, 5, 8, 12] as const;

export type AnalysisPriceOption = (typeof ANALYSIS_PRICE_OPTIONS)[number];

export function parseAnalysisPriceVote(value: unknown): AnalysisPriceOption {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The analysis price vote must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1
    || !Object.prototype.hasOwnProperty.call(record, "monthlyPriceEur")
    || !ANALYSIS_PRICE_OPTIONS.includes(record.monthlyPriceEur as AnalysisPriceOption)
  ) {
    throw new TypeError("The analysis price vote is invalid.");
  }
  return record.monthlyPriceEur as AnalysisPriceOption;
}
