-- Keep the complete proposal with the agreement revision, not just dead stones.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $scoring_proposal_constraints$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scoring_neutral_regions_array'
  AND conrelid = 'game_scoring_state'::regclass) THEN
ALTER TABLE game_scoring_state
  ADD COLUMN IF NOT EXISTS neutral_region_seeds JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS uncertain_stones JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS browser_bot_proposal_ready BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE game_scoring_state
  ADD CONSTRAINT game_scoring_neutral_regions_array CHECK (
    jsonb_typeof(neutral_region_seeds) = 'array' AND jsonb_array_length(neutral_region_seeds) <= 361
  ),
  ADD CONSTRAINT game_scoring_uncertain_stones_array CHECK (
    jsonb_typeof(uncertain_stones) = 'array' AND jsonb_array_length(uncertain_stones) <= 361
  ),
  ADD CONSTRAINT game_scoring_final_groups_resolved CHECK (
    finalized_at IS NULL OR uncertain_stones = '[]'::jsonb
  );
END IF;
END;
$scoring_proposal_constraints$;
