-- Let the trusted GoStone server role map verified OAuth identities while RLS
-- continues to block direct browser-facing Supabase roles.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON auth_identities TO gostone_app;

    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'auth_identities'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON auth_identities
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$$;
