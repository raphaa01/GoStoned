-- Repair deployments that skipped 038: imported answers need no engine search.
-- Preserve all catalog rows, attempts, permissions and historical engine counts.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE puzzles DROP CONSTRAINT IF EXISTS puzzles_visits_check;
ALTER TABLE puzzles ADD CONSTRAINT puzzles_visits_check CHECK (visits BETWEEN 0 AND 10000);
