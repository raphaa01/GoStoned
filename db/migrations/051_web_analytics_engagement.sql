-- Anonymous counters only: no accounts, cookies, IP addresses, or visitor IDs.
CREATE TABLE IF NOT EXISTS web_analytics_engagement (
  hour TIMESTAMPTZ NOT NULL,
  path TEXT NOT NULL CHECK (length(path) <= 160),
  views BIGINT NOT NULL DEFAULT 0 CHECK (views >= 0),
  visible_ms BIGINT NOT NULL DEFAULT 0 CHECK (visible_ms >= 0),
  PRIMARY KEY (hour, path)
);
ALTER TABLE web_analytics_engagement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_analytics_engagement FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON web_analytics_engagement FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON web_analytics_engagement FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON web_analytics_engagement TO gostone_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'web_analytics_engagement' AND policyname = 'gostone_app_engagement_access') THEN
      CREATE POLICY gostone_app_engagement_access ON web_analytics_engagement
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;
