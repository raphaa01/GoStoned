ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_beta_enabled BOOLEAN NOT NULL DEFAULT false;

-- Explicitly invited beta account; every other account remains opt-in.
UPDATE users SET coach_beta_enabled = true WHERE lower(username) = 'rapha';
