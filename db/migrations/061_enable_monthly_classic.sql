-- Production: apply only after the website with migration-060 support is live.
-- Old builds use ON CONFLICT(month,category), so do not remove it beforehand.
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_month_category_key;
UPDATE tournament_settings SET monthly_classic_enabled=true WHERE id=true;
