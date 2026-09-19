-- New accounts without a claimed rank now start at the 30 kyu anchor.
-- Existing v1 claims remain immutable and keep their original evidence.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE player_initial_rating_claims
  DROP CONSTRAINT IF EXISTS player_initial_rating_claims_policy_version_check;

ALTER TABLE player_initial_rating_claims
  ADD CONSTRAINT player_initial_rating_claims_policy_version_check
  CHECK (policy_version IN ('starting-strength-v1', 'starting-strength-v2'));
