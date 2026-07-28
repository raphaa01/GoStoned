import "dotenv/config";
import { closePool, query } from "../lib/db";
import { isLocalDatabase } from "../lib/env";

const requiredVariables = [
  "DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "LEGAL_NAME",
  "LEGAL_STREET",
  "LEGAL_CITY",
  "LEGAL_EMAIL",
] as const;

const requiredTables = [
  "schema_migrations",
  "users",
  "user_sessions",
  "guest_sessions",
  "auth_rate_limits",
  "games",
  "moves",
  "matchmaking_queue",
  "game_messages",
  "player_stats",
  "player_rating_history",
  "game_scoring_state",
  "game_dead_stones",
  "game_scoring_resume_events",
  "game_japanese_scoring_state",
  "game_japanese_dead_stones",
  "game_japanese_neutral_region_seeds",
] as const;

const requiredGameColumns = [
  "phase",
  "to_move",
  "consecutive_passes",
  "scoring_revision",
  "rules_profile",
  "scoring_method",
  "handicap",
  "finish_reason",
  "last_resume_claim",
  "last_resume_by",
  "last_resume_x",
  "last_resume_y",
] as const;

const requiredScoringColumns = [
  "board_hash",
  "revision",
  "rules_profile",
  "fallback_to_move",
  "expires_at",
  "black_confirmed_revision",
  "white_confirmed_revision",
  "finalized_at",
] as const;

const requiredQueueColumns = ["rules_profile"] as const;

const requiredJapaneseScoringColumns = [
  "proposal_hash",
  "black_confirmed_proposal_hash",
  "white_confirmed_proposal_hash",
  "scored_proposal_hash",
] as const;

const requiredResumeEventColumns = [
  "game_id",
  "scoring_revision",
  "board_hash",
  "stopped_move_number",
  "rules",
  "rules_profile",
  "scoring_method",
  "komi",
  "handicap",
  "fallback_to_move",
  "scoring_expires_at",
  "resume_claim",
  "requested_by_color",
  "disputed_x",
  "disputed_y",
  "resumed_to_move",
  "resumed_at",
] as const;

const requiredConstraintSignatures = [
  "games_rules_identity_unique:games:u",
  "games_supported_rules_tuple_check:games:c",
  "game_scoring_state_game_rules_fk:game_scoring_state:f",
  "game_japanese_scoring_game_rules_fk:game_japanese_scoring_state:f",
  "game_scoring_resume_events_pkey:game_scoring_resume_events:p",
  "game_scoring_resume_events_claim_shape_check:game_scoring_resume_events:c",
  "game_scoring_resume_events_game_rules_fk:game_scoring_resume_events:f",
  "matchmaking_queue_rules_profile_compatibility_check:matchmaking_queue:c",
] as const;

const requiredRolloutConstraintSignatures = [
  "moves_board_hash_required_check:moves:c",
] as const;

const requiredConstraintDefinitions = {
  moves_board_hash_required_check: {
    includes: ["CHECK ((board_hash IS NOT NULL))"],
    excludes: [],
  },
  games_rules_identity_unique: {
    includes: [
      "UNIQUE (id, rules, rules_profile, scoring_method, komi, handicap)",
    ],
    excludes: [],
  },
  games_supported_rules_tuple_check: {
    includes: [
      "legacy-immediate-area",
      "chinese-2002-gostone-v1",
      "japanese-1989-gostone-v1",
      "chinese",
      "japanese",
      "area",
      "territory",
      "6.5",
      "7.5",
    ],
    excludes: [],
  },
  game_scoring_state_game_rules_fk: {
    includes: [
      "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
      "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)",
      "ON DELETE CASCADE",
    ],
    excludes: [],
  },
  game_japanese_scoring_game_rules_fk: {
    includes: [
      "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
      "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)",
      "ON DELETE CASCADE",
    ],
    excludes: [],
  },
  game_scoring_resume_events_pkey: {
    includes: ["PRIMARY KEY (game_id, scoring_revision)"],
    excludes: [],
  },
  game_scoring_resume_events_claim_shape_check: {
    includes: [
      "resume_claim = 'dead'::text",
      "resume_claim = 'alive'::text",
      "resume_claim = 'deadline'::text",
      "resumed_to_move = requested_by_color",
      "resumed_to_move <> requested_by_color",
      "resumed_at < scoring_expires_at",
      "resumed_to_move = fallback_to_move",
      "scoring_expires_at <= resumed_at",
    ],
    excludes: [],
  },
  game_scoring_resume_events_game_rules_fk: {
    includes: [
      "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
      "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)",
      "ON DELETE CASCADE",
    ],
    excludes: [],
  },
  matchmaking_queue_rules_profile_compatibility_check: {
    includes: ["legacy-immediate-area", "chinese-2002-gostone-v1"],
    excludes: ["japanese-1989-gostone-v1"],
  },
} as const;

const requiredTriggerSignatures = [
  "matchmaking_rules_profile_guard:matchmaking_queue:public:enforce_matchmaking_rules_profile:23",
  "game_rules_identity_mutation_guard:games:public:guard_game_rules_identity_mutation:19",
  "game_scoring_resume_events_insert_guard:game_scoring_resume_events:public:validate_game_scoring_resume_event_insert:7",
  "game_scoring_resume_events_commit_guard:game_scoring_resume_events:public:validate_game_scoring_resume_event_commit:5",
  "game_scoring_resume_events_immutable_guard:game_scoring_resume_events:public:guard_game_scoring_resume_event_mutation:27",
  "game_scoring_resume_events_truncate_guard:game_scoring_resume_events:public:guard_game_scoring_resume_event_mutation:34",
  "game_japanese_scoring_state_mutation_guard:game_japanese_scoring_state:public:guard_japanese_scoring_state_mutation:27",
  "game_japanese_dead_stones_mutation_guard:game_japanese_dead_stones:public:guard_japanese_scoring_evidence_mutation:31",
  "game_japanese_neutral_seeds_mutation_guard:game_japanese_neutral_region_seeds:public:guard_japanese_scoring_evidence_mutation:31",
] as const;

const requiredTriggerDefinitions = {
  matchmaking_rules_profile_guard:
    "UPDATE OF status, game_id, rules_profile",
  game_rules_identity_mutation_guard:
    "UPDATE OF rules, rules_profile, scoring_method, komi, handicap",
  game_scoring_resume_events_insert_guard:
    "BEFORE INSERT ON public.game_scoring_resume_events",
  game_scoring_resume_events_commit_guard:
    "AFTER INSERT ON public.game_scoring_resume_events DEFERRABLE INITIALLY DEFERRED",
  game_scoring_resume_events_immutable_guard:
    "BEFORE DELETE OR UPDATE ON public.game_scoring_resume_events",
  game_scoring_resume_events_truncate_guard:
    "BEFORE TRUNCATE ON public.game_scoring_resume_events",
} as const;

const requiredProtectedTables = [
  "game_scoring_resume_events",
  "game_japanese_scoring_state",
  "game_japanese_dead_stones",
  "game_japanese_neutral_region_seeds",
] as const;

const requiredGuardFunctions = [
  "public.enforce_matchmaking_rules_profile()",
  "public.guard_game_rules_identity_mutation()",
  "public.validate_game_scoring_resume_event_insert()",
  "public.validate_game_scoring_resume_event_commit()",
  "public.guard_game_scoring_resume_event_mutation()",
  "public.guard_japanese_scoring_state_mutation()",
  "public.guard_japanese_scoring_evidence_mutation()",
] as const;

const requiredGuardFunctionDefinitions = {
  "public.validate_game_scoring_resume_event_insert()": [
    "FOR SHARE OF game, scoring",
    "NEW.scoring_revision IS DISTINCT FROM snapshot.snapshot_revision",
    "FROM public.game_dead_stones AS dead_stone",
  ],
  "public.validate_game_scoring_resume_event_commit()": [
    "lifecycle.scoring_revision IS DISTINCT FROM NEW.scoring_revision + 1",
    "lifecycle.last_resume_claim IS DISTINCT FROM NEW.resume_claim",
    "lifecycle.has_scoring_state",
  ],
  "public.guard_game_scoring_resume_event_mutation()": [
    "TG_OP = 'TRUNCATE'",
    "PERFORM 1 FROM public.games WHERE id = OLD.game_id",
    "Game scoring resume evidence is append-only.",
  ],
} as const;

async function checkMvp() {
  console.log("GoStone production preflight");

  const missing = requiredVariables.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL!);
  if (appUrl.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use https:// for production.");
  }

  const databaseUrl = process.env.DATABASE_URL!;
  if (isLocalDatabase(databaseUrl)) {
    throw new Error("DATABASE_URL still points to a local database.");
  }

  const database = await query<{
    now: Date;
    ssl: boolean;
    tables: string[];
    game_columns: string[];
    scoring_columns: string[];
    queue_columns: string[];
    japanese_scoring_columns: string[];
    resume_event_columns: string[];
    constraint_signatures: string[];
    rollout_constraint_signatures: string[];
    constraint_definitions: Record<string, string>;
    trigger_signatures: string[];
    trigger_definitions: Record<string, string>;
    rls_tables: string[];
    public_has_table_access: boolean;
    client_roles_have_table_access: boolean;
    public_can_execute_guard_functions: boolean;
    client_roles_can_execute_guard_functions: boolean;
    guard_function_definitions: Record<string, string>;
    rules_profile_default: string | null;
  }>(
    `SELECT NOW() AS now,
            (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
            ARRAY(
              SELECT table_name
                FROM information_schema.tables
               WHERE table_schema = 'public'
                 AND table_name = ANY($1::text[])
               ORDER BY table_name
            ) AS tables,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'games'
                 AND column_name = ANY($2::text[])
               ORDER BY column_name
            ) AS game_columns,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_scoring_state'
                 AND column_name = ANY($3::text[])
               ORDER BY column_name
            ) AS scoring_columns,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'matchmaking_queue'
                 AND column_name = ANY($4::text[])
               ORDER BY column_name
            ) AS queue_columns,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_japanese_scoring_state'
                 AND column_name = ANY($5::text[])
               ORDER BY column_name
            ) AS japanese_scoring_columns,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_scoring_resume_events'
                 AND column_name = ANY($13::text[])
               ORDER BY column_name
            ) AS resume_event_columns,
            ARRAY(
              SELECT constraint_row.conname || ':' || relation.relname || ':'
                     || constraint_row.contype::text
                FROM pg_constraint constraint_row
                JOIN pg_class relation ON relation.oid = constraint_row.conrelid
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
               WHERE constraint_row.conname || ':' || relation.relname || ':'
                     || constraint_row.contype::text = ANY($6::text[])
                 AND namespace.nspname = 'public'
                 AND constraint_row.convalidated
               ORDER BY constraint_row.conname
            ) AS constraint_signatures,
            ARRAY(
              SELECT constraint_row.conname || ':' || relation.relname || ':'
                     || constraint_row.contype::text
                FROM pg_constraint constraint_row
                JOIN pg_class relation ON relation.oid = constraint_row.conrelid
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
               WHERE constraint_row.conname || ':' || relation.relname || ':'
                     || constraint_row.contype::text = ANY($12::text[])
                 AND namespace.nspname = 'public'
               ORDER BY constraint_row.conname
            ) AS rollout_constraint_signatures,
            (
              SELECT COALESCE(
                JSONB_OBJECT_AGG(
                  constraint_row.conname,
                  pg_get_constraintdef(constraint_row.oid)
                ),
                '{}'::jsonb
              )
                FROM pg_constraint constraint_row
               WHERE constraint_row.conname = ANY($10::text[])
                 AND constraint_row.connamespace = 'public'::regnamespace
                 AND (
                   constraint_row.conname <> 'moves_board_hash_required_check'
                   OR constraint_row.conrelid = 'public.moves'::regclass
                 )
            ) AS constraint_definitions,
            ARRAY(
              SELECT trigger_row.tgname || ':' || relation.relname || ':'
                     || procedure_namespace.nspname || ':' || procedure.proname
                     || ':' || trigger_row.tgtype::text
                FROM pg_trigger trigger_row
                JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                JOIN pg_proc procedure ON procedure.oid = trigger_row.tgfoid
                JOIN pg_namespace procedure_namespace
                  ON procedure_namespace.oid = procedure.pronamespace
               WHERE trigger_row.tgname || ':' || relation.relname || ':'
                     || procedure_namespace.nspname || ':' || procedure.proname
                     || ':' || trigger_row.tgtype::text = ANY($7::text[])
                 AND namespace.nspname = 'public'
                 AND NOT trigger_row.tgisinternal
                 AND trigger_row.tgenabled IN ('O', 'A')
               ORDER BY trigger_row.tgname
            ) AS trigger_signatures,
            (
              SELECT COALESCE(
                JSONB_OBJECT_AGG(
                  trigger_row.tgname,
                  pg_get_triggerdef(trigger_row.oid)
                ),
                '{}'::jsonb
              )
                FROM pg_trigger trigger_row
               WHERE trigger_row.tgname = ANY($11::text[])
                 AND NOT trigger_row.tgisinternal
            ) AS trigger_definitions,
            ARRAY(
              SELECT relation.relname
                FROM pg_class relation
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
               WHERE namespace.nspname = 'public'
                 AND relation.relname = ANY($8::text[])
                 AND relation.relrowsecurity
               ORDER BY relation.relname
            ) AS rls_tables,
            EXISTS (
              SELECT 1
                FROM UNNEST($8::text[]) AS protected_table(table_name)
               WHERE has_table_privilege(
                       'public',
                       FORMAT('public.%I', protected_table.table_name),
                       'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
                     )
                  OR has_any_column_privilege(
                       'public',
                       FORMAT('public.%I', protected_table.table_name),
                       'SELECT, INSERT, UPDATE, REFERENCES'
                     )
            ) AS public_has_table_access,
            EXISTS (
              SELECT 1
                FROM pg_roles role
                CROSS JOIN UNNEST($8::text[]) AS protected_table(table_name)
               WHERE role.rolname IN ('anon', 'authenticated')
                 AND (
                   has_table_privilege(
                     role.oid,
                     FORMAT('public.%I', protected_table.table_name),
                     'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
                   )
                   OR has_any_column_privilege(
                     role.oid,
                     FORMAT('public.%I', protected_table.table_name),
                     'SELECT, INSERT, UPDATE, REFERENCES'
                   )
                 )
            ) AS client_roles_have_table_access,
            EXISTS (
              SELECT 1
                FROM UNNEST($9::text[]) AS guard_function(function_name)
               WHERE has_function_privilege(
                 'public',
                 guard_function.function_name,
                 'EXECUTE'
               )
            ) AS public_can_execute_guard_functions,
            EXISTS (
              SELECT 1
                FROM pg_roles role
                CROSS JOIN UNNEST($9::text[]) AS guard_function(function_name)
               WHERE role.rolname IN ('anon', 'authenticated')
                 AND has_function_privilege(
                   role.oid,
                   guard_function.function_name,
                   'EXECUTE'
                 )
            ) AS client_roles_can_execute_guard_functions,
            (
              SELECT COALESCE(
                JSONB_OBJECT_AGG(
                  guard_function.function_name,
                  pg_get_functiondef(guard_function.function_name::regprocedure)
                ),
                '{}'::jsonb
              )
                FROM UNNEST($14::text[]) AS guard_function(function_name)
            ) AS guard_function_definitions,
            (
              SELECT column_default
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'games'
                 AND column_name = 'rules_profile'
            ) AS rules_profile_default`,
    [
      requiredTables,
      requiredGameColumns,
      requiredScoringColumns,
      requiredQueueColumns,
      requiredJapaneseScoringColumns,
      requiredConstraintSignatures,
      requiredTriggerSignatures,
      requiredProtectedTables,
      requiredGuardFunctions,
      Object.keys(requiredConstraintDefinitions),
      Object.keys(requiredTriggerDefinitions),
      requiredRolloutConstraintSignatures,
      requiredResumeEventColumns,
      Object.keys(requiredGuardFunctionDefinitions),
    ],
  );

  const row = database.rows[0];
  const absentTables = requiredTables.filter((table) => !row.tables.includes(table));
  if (absentTables.length > 0) {
    throw new Error(
      `Database migrations are incomplete. Missing tables: ${absentTables.join(", ")}`,
    );
  }
  const absentGameColumns = requiredGameColumns.filter(
    (column) => !row.game_columns.includes(column),
  );
  if (absentGameColumns.length > 0) {
    throw new Error(
      `Database scoring migration is incomplete. Missing games columns: ${absentGameColumns.join(", ")}`,
    );
  }
  const absentScoringColumns = requiredScoringColumns.filter(
    (column) => !row.scoring_columns.includes(column),
  );
  if (absentScoringColumns.length > 0) {
    throw new Error(
      `Database scoring migration is incomplete. Missing scoring columns: ${absentScoringColumns.join(", ")}`,
    );
  }
  const absentQueueColumns = requiredQueueColumns.filter(
    (column) => !row.queue_columns.includes(column),
  );
  if (absentQueueColumns.length > 0) {
    throw new Error(
      `Database matchmaking migration is incomplete. Missing queue columns: ${absentQueueColumns.join(", ")}`,
    );
  }
  const absentJapaneseScoringColumns = requiredJapaneseScoringColumns.filter(
    (column) => !row.japanese_scoring_columns.includes(column),
  );
  if (absentJapaneseScoringColumns.length > 0) {
    throw new Error(
      `Database Japanese persistence migration is incomplete. Missing scoring columns: ${absentJapaneseScoringColumns.join(", ")}`,
    );
  }
  const absentResumeEventColumns = requiredResumeEventColumns.filter(
    (column) => !row.resume_event_columns.includes(column),
  );
  if (absentResumeEventColumns.length > 0) {
    throw new Error(
      `Database resume evidence migration is incomplete. Missing columns: ${absentResumeEventColumns.join(", ")}`,
    );
  }
  const absentConstraints = requiredConstraintSignatures.filter(
    (constraint) => !row.constraint_signatures.includes(constraint),
  );
  if (absentConstraints.length > 0) {
    throw new Error(
      `Database persistence invariants are incomplete. Missing constraints: ${absentConstraints.join(", ")}`,
    );
  }
  const absentRolloutConstraints = requiredRolloutConstraintSignatures.filter(
    (constraint) => !row.rollout_constraint_signatures.includes(constraint),
  );
  if (absentRolloutConstraints.length > 0) {
    throw new Error(
      `Database rollout invariants are incomplete. Missing constraints: ${absentRolloutConstraints.join(", ")}`,
    );
  }
  for (const [name, contract] of Object.entries(requiredConstraintDefinitions)) {
    const definition = row.constraint_definitions[name] ?? "";
    const missingFragments = contract.includes.filter(
      (fragment) => !definition.includes(fragment),
    );
    const forbiddenFragments = contract.excludes.filter(
      (fragment) => definition.includes(fragment),
    );
    if (missingFragments.length > 0 || forbiddenFragments.length > 0) {
      throw new Error(`Database constraint definition is unsafe: ${name}`);
    }
  }
  const absentTriggers = requiredTriggerSignatures.filter(
    (trigger) => !row.trigger_signatures.includes(trigger),
  );
  if (absentTriggers.length > 0) {
    throw new Error(
      `Database persistence guards are incomplete. Missing triggers: ${absentTriggers.join(", ")}`,
    );
  }
  for (const [name, fragment] of Object.entries(requiredTriggerDefinitions)) {
    if (!(row.trigger_definitions[name] ?? "").includes(fragment)) {
      throw new Error(`Database trigger definition is unsafe: ${name}`);
    }
  }
  const absentRls = requiredProtectedTables.filter(
    (table) => !row.rls_tables.includes(table),
  );
  if (absentRls.length > 0) {
    throw new Error(
      `Database client isolation is incomplete. RLS is disabled on: ${absentRls.join(", ")}`,
    );
  }
  if (row.public_has_table_access) {
    throw new Error(
      "Database client isolation is incomplete: PUBLIC can access protected server tables.",
    );
  }
  if (row.client_roles_have_table_access) {
    throw new Error(
      "Database client isolation is incomplete: anon/authenticated can access protected server tables.",
    );
  }
  if (row.public_can_execute_guard_functions) {
    throw new Error(
      "Database persistence guards are callable through the PUBLIC pseudo-role.",
    );
  }
  if (row.client_roles_can_execute_guard_functions) {
    throw new Error(
      "Database persistence guards are callable through anon/authenticated roles.",
    );
  }
  for (const [name, fragments] of Object.entries(requiredGuardFunctionDefinitions)) {
    const definition = row.guard_function_definitions[name] ?? "";
    if (fragments.some((fragment) => !definition.includes(fragment))) {
      throw new Error(`Database guard function definition is unsafe: ${name}`);
    }
  }
  if (!row.rules_profile_default?.includes("legacy-immediate-area")) {
    throw new Error(
      "Migration 008 is not rollout-safe: games.rules_profile must keep the legacy default during the expand phase.",
    );
  }
  if (!row.ssl) {
    throw new Error("The production database connection is not using SSL.");
  }

  console.log(`Database connected securely at ${row.now.toISOString()}.`);
  console.log("Required tables and legal configuration are present.");
  console.log("MVP production preflight passed.");
}

checkMvp()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
