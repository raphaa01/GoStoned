export type ProductionSchemaSnapshot = Readonly<{
  gameRulesDefault: string | null;
  gameRulesProfileDefault: string | null;
  gameScoringMethodDefault: string | null;
  gameKomiDefault: string | null;
  queueRulesProfileDefault: string | null;
  queueProfileConstraint: string | null;
  queueAdaptiveConstraint: string | null;
  initialRatingPolicyConstraint: string | null;
  puzzleCategoryConstraint: string | null;
  boardPlacementDataType: string | null;
  boardPlacementDefault: string | null;
  boardPlacementNullable: string | null;
  boardPlacementConstraint: string | null;
  boardDesignDataType: string | null;
  boardDesignDefault: string | null;
  boardDesignNullable: string | null;
  boardDesignConstraint: string | null;
  analysisProgressDataType: string | null;
  analysisProgressConstraint: string | null;
  takebackRls: boolean;
  learnProgressRls: boolean;
  learnProgressWritable: boolean;
  analysisPriceVoteConstraint: string | null;
  analysisPriceVotePrimary: string | null;
  analysisPriceVoteRls: boolean;
  analysisPriceVoteWritable: boolean;
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
  if (snapshot.boardDesignDataType !== "text" || snapshot.boardDesignNullable !== "NO") {
    throw new Error("Production database schema is stale: board-design preference column.");
  }
  requireFragment(snapshot.boardDesignDefault, "default", "board-design preference default");
  for (const design of ["default", "light-oak", "dark-slate", "white-porcelain", "sage", "bordeaux"]) {
    requireFragment(snapshot.boardDesignConstraint, design, "board-design preference constraint");
  }
  if (!snapshot.learnProgressRls || !snapshot.learnProgressWritable) {
    throw new Error("Production database schema is stale: learning progress storage or server permissions.");
  }
  if (!snapshot.analysisPriceVoteRls || !snapshot.analysisPriceVoteWritable) {
    throw new Error("Production database schema is stale: analysis price-vote storage or server permissions.");
  }
  requireFragment(
    snapshot.analysisPriceVotePrimary,
    "PRIMARY KEY (user_id)",
    "analysis price-vote account uniqueness",
  );
  for (const fragment of ["monthly_price_eur", "3", "5", "8", "12"]) {
    requireFragment(
      snapshot.analysisPriceVoteConstraint,
      fragment,
      "analysis price-vote allowed values",
    );
  }
  if (snapshot.analysisProgressDataType !== "jsonb") {
    throw new Error(
      "Production database schema is stale: progressive analysis column.",
    );
  }
  for (const fragment of ["status = 'running'", "progress IS NOT NULL"]) {
    requireFragment(
      snapshot.analysisProgressConstraint,
      fragment,
      "progressive analysis result constraint",
    );
  }
  if (
    snapshot.boardPlacementDataType !== "text"
    || snapshot.boardPlacementNullable !== "NO"
  ) {
    throw new Error(
      "Production database schema is stale: board-placement preference column.",
    );
  }
  requireFragment(
    snapshot.boardPlacementDefault,
    "zoom",
    "board-placement preference default",
  );
  for (const fragment of ["zoom", "direct"]) {
    requireFragment(
      snapshot.boardPlacementConstraint,
      fragment,
      "board-placement preference constraint",
    );
  }
  requireFragment(
    snapshot.initialRatingPolicyConstraint,
    "starting-strength-v2",
    "new-account rating-policy constraint",
  );
  for (const fragment of ["gokyo_life", "gokyo_death", "gokyo_ko", "board_size = 19"]) {
    requireFragment(
      snapshot.puzzleCategoryConstraint,
      fragment,
      "historical puzzle-category constraint",
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
