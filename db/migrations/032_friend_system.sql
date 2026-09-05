-- Account friendships, durable direct messages, and explicitly unrated friend games.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE games
  ADD COLUMN game_type TEXT NOT NULL DEFAULT 'matchmaking';

ALTER TABLE games
  ADD CONSTRAINT games_game_type_check
  CHECK (game_type IN ('matchmaking', 'friendly'));

CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  responded_at TIMESTAMPTZ,
  CHECK (requester_id <> addressee_id),
  CHECK (updated_at >= created_at),
  CHECK (
    (status = 'pending' AND responded_at IS NULL)
    OR (status = 'accepted' AND responded_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX friendships_unique_pair
  ON friendships (
    LEAST(requester_id::text, addressee_id::text),
    GREATEST(requester_id::text, addressee_id::text)
  );

CREATE INDEX friendships_addressee_pending
  ON friendships(addressee_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX friendships_requester_status
  ON friendships(requester_id, status, updated_at DESC);

CREATE TABLE friend_messages (
  id BIGSERIAL PRIMARY KEY,
  friendship_id UUID NOT NULL REFERENCES friendships(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (CHAR_LENGTH(BTRIM(message)) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  read_at TIMESTAMPTZ,
  CHECK (read_at IS NULL OR read_at >= created_at)
);

CREATE INDEX friend_messages_conversation
  ON friend_messages(friendship_id, id DESC);

CREATE INDEX friend_messages_unread
  ON friend_messages(friendship_id, sender_id, id)
  WHERE read_at IS NULL;

CREATE TABLE friend_game_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  friendship_id UUID NOT NULL REFERENCES friendships(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  time_control TEXT NOT NULL CHECK (time_control IN ('blitz', 'rapid', 'classic')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  CHECK (inviter_id <> invitee_id),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'pending' AND responded_at IS NULL AND game_id IS NULL)
    OR (status = 'accepted' AND responded_at IS NOT NULL AND game_id IS NOT NULL)
    OR (status IN ('declined', 'cancelled', 'expired')
        AND responded_at IS NOT NULL AND game_id IS NULL)
  )
);

CREATE UNIQUE INDEX friend_game_invites_one_pending_pair
  ON friend_game_invites(
    LEAST(inviter_id::TEXT, invitee_id::TEXT),
    GREATEST(inviter_id::TEXT, invitee_id::TEXT)
  )
  WHERE status = 'pending';

CREATE INDEX friend_game_invites_participant_activity
  ON friend_game_invites(invitee_id, status, created_at DESC);

CREATE INDEX friend_game_invites_inviter_activity
  ON friend_game_invites(inviter_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_friendly_game_rating_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.games WHERE id=NEW.game_id AND game_type='friendly') THEN
    RAISE EXCEPTION 'Friendly games cannot produce rating evidence.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS friendly_game_rating_event_guard ON game_glicko2_rating_events;
CREATE TRIGGER friendly_game_rating_event_guard
  BEFORE INSERT ON game_glicko2_rating_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_friendly_game_rating_event();

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_game_invites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON friendships, friend_messages, friend_game_invites FROM PUBLIC;
REVOKE ALL ON SEQUENCE friend_messages_id_seq FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON friendships, friend_messages, friend_game_invites FROM anon;
    REVOKE ALL ON SEQUENCE friend_messages_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON friendships, friend_messages, friend_game_invites FROM authenticated;
    REVOKE ALL ON SEQUENCE friend_messages_id_seq FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON friendships, friend_messages, friend_game_invites
      TO gostone_app;
    GRANT USAGE, SELECT ON SEQUENCE friend_messages_id_seq TO gostone_app;

    CREATE POLICY gostone_app_server_access ON friendships
      FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    CREATE POLICY gostone_app_server_access ON friend_messages
      FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    CREATE POLICY gostone_app_server_access ON friend_game_invites
      FOR ALL TO gostone_app USING (true) WITH CHECK (true);
  END IF;
END
$$;
