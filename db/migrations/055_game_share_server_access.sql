-- Share links are accessible only through the server's participant/token checks.
REVOKE ALL ON game_share_links FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON game_share_links TO gostone_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'game_share_links'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON game_share_links
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;
