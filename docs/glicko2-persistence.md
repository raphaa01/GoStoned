# Global Glicko-2 persistence v1

Migration 026 activates `glicko2-v1-tau-0.5` as the only mutable rating
source. `player_glicko2_ratings` has exactly one row per registered account,
independent of board size and time control. New or previously unrated accounts
start at rating 1200, rating deviation 350, and volatility 0.06. The initial
`last_rating_period_at` is the state-creation time. `is_provisional` is derived
from fewer than ten Glicko-2-rated games; it is not independently mutable.

## Legacy migration

The old model can contain one current rating for each of 9×9, 13×13, and
19×19. One global state cannot preserve all three values. Migration 025 copies
the integer from the most recently updated `player_stats` row exactly. A tie is
resolved by games descending and then board size ascending. It does not average
ratings or select the highest rating. Accounts without a legacy row start at
1200.

Every legacy `player_stats` and `player_rating_history` row remains unchanged.
Legacy history is labeled `fixed-elo-legacy-v1`; new Glicko-2 evidence is stored
separately and never misrepresents a fixed ±16 update as Glicko-2.

## Transaction and evidence boundary

`finalizeGameRatings(client, gameId)` runs inside the caller's terminal-game
transaction. It locks the game first and then both global account states in
stable player-key order. Both players are evaluated against the same pre-period
states. It appends exactly two immutable `game_glicko2_rating_events` rows and
then advances both states. Deferred database validation requires the complete
pair and the matching post-period states before commit.

Repeated processing returns the already-committed exact pair. Partial or
contradictory evidence fails closed. Concurrent games sharing either player
serialize on the global state rows. A Japanese adjudication no-result or
two-party exact-board repetition appends paired
same-before/after evidence without advancing rating, deviation, volatility,
game count, or last period. Guests remain unrated.

The event contract reserves an explicit `calibrated_bot` opponent kind, but v1
accepts only two registered humans. A heuristic target rating is never accepted
as bot calibration evidence. Bot games remain unrated until a later migration
binds an immutable versioned calibration profile to the game.

## Rollback

Rollback is application-first: stop calling the Glicko-2 finalizer while
retaining both new tables and their append-only evidence. Do not resume the old
fixed updater for games already carrying Glicko-2 events, do not relabel legacy
history, and do not rewrite stored game results. Dropping rating evidence or
reconstructing old per-board values is intentionally outside an operational
rollback.
