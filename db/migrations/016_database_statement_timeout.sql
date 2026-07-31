-- Bound direct pooled reads as well as transactional mutations without
-- changing other roles or databases in the PostgreSQL cluster.
DO $gostone_statement_timeout$
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'GoStone migrations require the authenticated database role.';
  END IF;

  EXECUTE pg_catalog.format(
    'ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
    current_user,
    current_database(),
    '8s'
  );

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_db_role_setting AS setting
      JOIN pg_catalog.pg_database AS database ON database.oid = setting.setdatabase
      JOIN pg_catalog.pg_roles AS role ON role.oid = setting.setrole
     WHERE database.datname = current_database()
       AND role.rolname = current_user
       AND 'statement_timeout=8s' = ANY(setting.setconfig)
  ) THEN
    RAISE EXCEPTION 'The GoStone database statement timeout could not be verified.';
  END IF;
END
$gostone_statement_timeout$;
