-- Bound direct pooled reads as well as transactional mutations without
-- changing other roles or databases in the PostgreSQL cluster.
DO $gostone_statement_timeout$
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'GoStone migrations require the authenticated database role.';
  END IF;
  IF NOT pg_catalog.has_parameter_privilege(current_user, 'statement_timeout', 'SET') THEN
    RAISE EXCEPTION 'The GoStone database role cannot set statement_timeout.';
  END IF;

  EXECUTE pg_catalog.format(
    'ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
    current_user,
    current_database(),
    '8s'
  );
END
$gostone_statement_timeout$;
