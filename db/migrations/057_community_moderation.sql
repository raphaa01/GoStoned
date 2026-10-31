-- Server-only consent, moderation ownership, decisions and temporary restrictions.
CREATE TABLE IF NOT EXISTS community_acceptances (
  player_key TEXT PRIMARY KEY CHECK (player_key ~ '^(user|guest):[0-9a-f-]{36}$'),
  rules_version TEXT NOT NULL CHECK (length(rules_version) BETWEEN 1 AND 32),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE IF NOT EXISTS moderation_moderators (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
-- One-time operator-requested provisioning: subsequent authorization uses only
-- the captured UUID. Deleting/recreating this username does not inherit access.
INSERT INTO moderation_moderators (user_id)
SELECT id FROM users WHERE username = 'rapha' ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS moderation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_kind TEXT NOT NULL CHECK (context_kind IN ('game', 'friend')),
  context_id UUID NOT NULL,
  evidence_cursor BIGINT NOT NULL DEFAULT 0 CHECK (evidence_cursor >= 0),
  reporter_key TEXT NOT NULL,
  reported_key TEXT NOT NULL,
  category_code TEXT NOT NULL CHECK (category_code IN ('abuse_or_hate', 'threat_or_sexual_safety', 'fair_play', 'stalling_or_abandonment', 'spam_scam_or_identity', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (context_kind, context_id, reporter_key, evidence_cursor),
  CHECK (reporter_key <> reported_key)
);
INSERT INTO moderation_cases (context_kind, context_id, reporter_key, reported_key, category_code, created_at)
SELECT 'game', game_id, reporter_key, reported_key, category_code, created_at FROM player_reports ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS moderation_decisions (
  case_id UUID PRIMARY KEY REFERENCES moderation_cases(id) ON DELETE CASCADE,
  moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('dismiss', 'remove_chat', 'suspend_7d', 'restore')),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE IF NOT EXISTS player_restrictions (
  player_key TEXT PRIMARY KEY CHECK (player_key ~ '^(user|guest):[0-9a-f-]{36}$'),
  restricted_until TIMESTAMPTZ NOT NULL,
  source_case_id UUID REFERENCES moderation_cases(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE IF NOT EXISTS moderation_audit (
  id BIGSERIAL PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('dismiss', 'remove_chat', 'suspend_7d', 'restore')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE moderation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON moderation_audit FROM PUBLIC;
ALTER TABLE game_messages ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE friend_messages ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS moderation_cases_triage ON moderation_cases(created_at, id);
CREATE INDEX IF NOT EXISTS moderation_cases_reporter ON moderation_cases(reporter_key);
CREATE INDEX IF NOT EXISTS moderation_cases_reported ON moderation_cases(reported_key);
CREATE INDEX IF NOT EXISTS game_messages_moderated ON game_messages(moderated_at, id) WHERE moderated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS friend_messages_moderated ON friend_messages(moderated_at, id) WHERE moderated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS player_reports_triage ON player_reports(created_at, game_id, reporter_key);
CREATE INDEX IF NOT EXISTS player_restrictions_expiry ON player_restrictions(restricted_until);

ALTER TABLE community_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_moderators ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_restrictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON community_acceptances, moderation_moderators, moderation_cases, moderation_decisions, moderation_audit, player_restrictions FROM PUBLIC;
DO $$
DECLARE role_name TEXT; table_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON community_acceptances, moderation_moderators, moderation_cases, moderation_decisions, moderation_audit, player_restrictions FROM %I', role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON community_acceptances, player_restrictions TO gostone_app;
    GRANT SELECT ON moderation_moderators TO gostone_app;
    GRANT UPDATE (moderated_at) ON game_messages TO gostone_app;
    GRANT SELECT, INSERT, DELETE ON moderation_cases TO gostone_app;
    GRANT SELECT, INSERT, UPDATE ON moderation_decisions TO gostone_app;
    GRANT SELECT, INSERT ON moderation_audit TO gostone_app;
    GRANT USAGE, SELECT ON SEQUENCE moderation_audit_id_seq TO gostone_app;
    GRANT UPDATE (moderated_at) ON friend_messages TO gostone_app;
    GRANT DELETE ON game_messages, friend_messages TO gostone_app;
    FOREACH table_name IN ARRAY ARRAY['community_acceptances', 'moderation_moderators', 'moderation_cases', 'moderation_decisions', 'moderation_audit', 'player_restrictions'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS gostone_app_server_access ON %I', table_name);
      EXECUTE format('CREATE POLICY gostone_app_server_access ON %I TO gostone_app USING (true) WITH CHECK (true)', table_name);
    END LOOP;
  END IF;
END $$;

-- Remove newly introduced personal state through existing account/guest erasure.
CREATE OR REPLACE FUNCTION cleanup_community_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE identity_key TEXT;
BEGIN
  identity_key := CASE WHEN TG_TABLE_NAME = 'users' THEN 'user:' || (to_jsonb(OLD)->>'id')
    ELSE 'guest:' || (to_jsonb(OLD)->>'guest_id') END;
  DELETE FROM community_acceptances WHERE player_key = identity_key;
  DELETE FROM player_restrictions WHERE player_key = identity_key;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS users_community_cleanup ON users;
CREATE TRIGGER users_community_cleanup AFTER DELETE ON users FOR EACH ROW EXECUTE FUNCTION cleanup_community_identity();
DROP TRIGGER IF EXISTS guests_community_cleanup ON guest_sessions;
CREATE TRIGGER guests_community_cleanup AFTER DELETE ON guest_sessions FOR EACH ROW EXECUTE FUNCTION cleanup_community_identity();

-- Capture immutable game reports atomically, including clients released earlier.
CREATE OR REPLACE FUNCTION enqueue_game_moderation_case() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO moderation_cases (context_kind, context_id, reporter_key, reported_key, category_code, created_at)
  VALUES ('game', NEW.game_id, NEW.reporter_key, NEW.reported_key, NEW.category_code, NEW.created_at) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS player_report_moderation_case ON player_reports;
CREATE TRIGGER player_report_moderation_case AFTER INSERT ON player_reports FOR EACH ROW EXECUTE FUNCTION enqueue_game_moderation_case();
