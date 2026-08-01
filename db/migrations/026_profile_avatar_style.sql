SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_style TEXT;

UPDATE users
   SET avatar_style = 'kifu-classic'
 WHERE avatar_style IS NULL
    OR avatar_style NOT IN ('kifu-classic', 'urushi-mon');

ALTER TABLE users
  ALTER COLUMN avatar_style SET DEFAULT 'kifu-classic',
  ALTER COLUMN avatar_style SET NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_avatar_style_check;

ALTER TABLE users
  ADD CONSTRAINT users_avatar_style_check
  CHECK (avatar_style IN ('kifu-classic', 'urushi-mon'));
