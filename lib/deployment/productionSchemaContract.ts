export const JAPANESE_RULES_MIGRATION = "037_japanese_rules_and_takebacks.sql";

export type ProductionSchemaSnapshot = Readonly<{
  migrationApplied: boolean;
  gameRulesDefault: string | null;
  gameRulesProfileDefault: string | null;
  gameScoringMethodDefault: string | null;
  gameKomiDefault: string | null;
  queueRulesProfileDefault: string | null;
  queueProfileConstraint: string | null;
  queueAdaptiveConstraint: string | null;
  takebackRls: boolean;
}>;

function requireFragment(
  value: string | null,
  fragment: string,
  label: string,
): void {
  if (!value?.includes(fragment)) {
    throw new Error(`Production database schema is stale: ${label}.`);
  }
}

export function validateProductionSchemaContract(
  snapshot: ProductionSchemaSnapshot,
): void {
  if (!snapshot.migrationApplied) {
    throw new Error(
      `Production database migration is missing: ${JAPANESE_RULES_MIGRATION}.`,
    );
  }

  requireFragment(snapshot.gameRulesDefault, "japanese", "games.rules default");
  requireFragment(
    snapshot.gameRulesProfileDefault,
    "japanese-1989-gostone-v1",
    "games.rules_profile default",
  );
  requireFragment(
    snapshot.gameScoringMethodDefault,
    "territory",
    "games.scoring_method default",
  );
  requireFragment(snapshot.gameKomiDefault, "6.5", "games.komi default");
  requireFragment(
    snapshot.queueRulesProfileDefault,
    "japanese-1989-gostone-v1",
    "matchmaking_queue.rules_profile default",
  );
  requireFragment(
    snapshot.queueProfileConstraint,
    "japanese-1989-gostone-v1",
    "matchmaking rules-profile constraint",
  );

  for (const fragment of [
    "rules_snapshot = 'japanese'",
    "rules_version_snapshot = 'japanese-1989-gostone-v1'",
    "scoring_method_snapshot = 'territory'",
    "komi_snapshot = 6.5",
  ]) {
    requireFragment(
      snapshot.queueAdaptiveConstraint,
      fragment,
      "adaptive matchmaking constraint",
    );
  }

  if (!snapshot.takebackRls) {
    throw new Error(
      "Production database schema is stale: game_takeback_requests RLS.",
    );
  }
}
