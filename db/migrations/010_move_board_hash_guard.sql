SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Rollback floor: application versions older than migration 002 omitted this
-- evidence and must not write after this guard is installed. Every supported
-- deployment-window writer already supplies the post-move board hash.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'moves_board_hash_required_check'
       AND conrelid = 'public.moves'::regclass
  ) THEN
    -- Historical rows from before migration 002 may remain NULL. PostgreSQL
    -- still enforces a NOT VALID CHECK for every subsequent insert or update.
    ALTER TABLE public.moves
      ADD CONSTRAINT moves_board_hash_required_check
      CHECK (board_hash IS NOT NULL) NOT VALID;
  END IF;
END
$$;
