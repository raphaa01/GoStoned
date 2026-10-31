-- Override inherited installation defaults before granting the minimum runtime
-- permissions. Moderator provisioning stays with the database operator.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    REVOKE ALL ON community_acceptances, moderation_moderators, moderation_cases,
      moderation_decisions, moderation_audit, player_restrictions FROM gostone_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON community_acceptances, player_restrictions TO gostone_app;
    GRANT SELECT ON moderation_moderators TO gostone_app;
    GRANT SELECT, INSERT, DELETE ON moderation_cases TO gostone_app;
    GRANT SELECT, INSERT, UPDATE ON moderation_decisions TO gostone_app;
    GRANT SELECT, INSERT ON moderation_audit TO gostone_app;
    REVOKE ALL ON SEQUENCE moderation_audit_id_seq FROM gostone_app;
    GRANT USAGE, SELECT ON SEQUENCE moderation_audit_id_seq TO gostone_app;
  END IF;
END $$;
