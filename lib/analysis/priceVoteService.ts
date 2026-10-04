import { query } from "@/lib/db";
import type { AnalysisPriceOption } from "./priceVote";

type AnalysisPriceVoteRow = {
  monthly_price_eur: AnalysisPriceOption;
};

export async function getAnalysisPriceVote(
  userId: string,
): Promise<AnalysisPriceOption | null> {
  const result = await query<AnalysisPriceVoteRow>(
    `SELECT monthly_price_eur
       FROM analysis_price_votes
      WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0]?.monthly_price_eur ?? null;
}

export async function saveAnalysisPriceVote(
  userId: string,
  monthlyPriceEur: AnalysisPriceOption,
): Promise<AnalysisPriceOption> {
  const result = await query<AnalysisPriceVoteRow>(
    `INSERT INTO analysis_price_votes (user_id, monthly_price_eur)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET monthly_price_eur = EXCLUDED.monthly_price_eur,
           updated_at = statement_timestamp()
     RETURNING monthly_price_eur`,
    [userId, monthlyPriceEur],
  );
  const saved = result.rows[0]?.monthly_price_eur;
  if (saved === undefined) throw new Error("The analysis price vote could not be saved.");
  return saved;
}
