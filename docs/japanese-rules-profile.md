# Japanese 1989 rules profile

## Active profile

New games use the exact persisted tuple:

- ruleset `japanese`;
- profile `japanese-1989-gostone-v1`;
- territory scoring;
- 6.5 komi;
- handicap 0; and
- 9×9, 13×13, or 19×19 boards.

Handicap selection remains intentionally unavailable until fixed placement and
handicap komi have their own verified lifecycle. Existing Chinese games keep
their persisted rules and continue through the historical Chinese service.
Operations may set `GOSTONE_NEW_GAME_RULES_PROFILE=chinese-2002-gostone-v1` to
stop creating Japanese games without reinterpreting or mutating existing games.

The rules authority is the [Nihon Ki-in and Kansai Ki-in 1989 Japanese Rules of
Go](https://www.nihonkiin.or.jp/match/kiyaku/zenbun.html). The implementation
maps the material rules as follows:

- Articles 4–5: liberties, capture, and suicide are enforced by the move kernel.
- Article 6: normal play uses simple ko, not positional superko.
- Articles 7–8: scoring distinguishes living/dead stones, territory, seki, and
  dame; living stones are not points.
- Article 9: two consecutive passes stop play; both players must agree on the
  exact settlement revision; a resumption request gives the opponent first move.
- Article 10: agreed dead stones become prisoners, and territory plus prisoners
  and komi determine the result.
- Article 11: resignation is independently terminal.
- Article 12: a whole-board repetition becomes no-result only after both players
  claim the same repeated position.

GoStone's 6.5 komi is a versioned match condition rather than a claim that the
1989 text fixed komi. The Nihon Ki-in [announced adoption of 6.5 komi in
2002](https://www.nihonkiin.or.jp/english/topics/02/topics2002_10.htm).

## Scoring lifecycle

Two passes immediately create a server-authoritative stopped position and an
empty manual proposal. Players can therefore score even when no model is
installed or the browser model fails. A click, tap, or keyboard action toggles
the complete connected group. Each edit creates a revision and clears both
confirmations. Finalization occurs atomically only when both players confirm the
same revision.

Either player can resume up to three times; the requester's opponent moves
first. The next pass-pass creates a new stopped position. After the third
resumption the UI labels scoring as the final resolution phase.

The normal game clock is paused in scoring. A separate visible deadline defaults
to five minutes and can be configured with
`JAPANESE_SCORING_DECISION_SECONDS=300` (30–3600 seconds). At expiry:

- one participating player and one inactive player: the inactive player loses
  by abandonment;
- neither player participates: no-result/no-participation; or
- both participate but do not agree: no-result/unresolved-after-participation.

No model is allowed to adjudicate a result, and inactivity is never agreement.

## Optional partner-model boundary

The only integration point is `JapaneseSettlementProvider` in
`lib/game/japaneseSettlementProvider.ts`. The existing browser worker adapter is
`lib/bot/browserJapaneseSettlementProvider.ts`. A replacement model must return
`gostone-japanese-settlement-provider-v1` and echo the exact game id, board size,
stopped-board hash, stopped move number, and scoring revision. It identifies its
provider/model version and proposes complete dead groups, complete uncertain
groups, and neutral-region seeds.

The server rejects stale output, partial groups, empty dead points, duplicates,
dead/uncertain overlap, malformed hashes, and extension fields. Accepted output
is still only `authority: proposal-only`: players can edit it, both must confirm,
and GoStone recomputes the score with its own Japanese scoring kernel. Replacing
the model requires changing only the adapter/model artifact, not game rules,
database code, routes, or UI.

## Database and rollout

Migration `032_provider_neutral_japanese_rules.sql` activates the profile,
persists proposal/resume/deadline/repetition evidence, and installs mutation
guards. Apply it only through the normal migration command. Do not edit an
already-applied migration or manually mutate production data.

Rollback is creation-only: set the new-game profile override to the current
Chinese profile and redeploy. Existing Japanese games must stay readable and be
allowed to finish under their persisted profile. Reverting or deleting Japanese
rows, tables, or rules code is not a rollback procedure.

Local verification:

```sh
npm run typecheck
npm test
npm run build
```

With the explicitly configured local smoke database, also run
`npm run test:migrations-db`. Never point smoke tests at a hosted database.
