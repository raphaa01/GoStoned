# Global rating and matchmaking contract

GoStone uses one global `glicko2-v1-tau-0.5` state for every registered
account. Board size is not a separate ladder. Each eligible completed game is
one rating period. The current v1 policy does not add inactivity-only periods;
`last_rating_period_at` advances only for a rated win, loss, or draw. A
no-result writes immutable zero-change evidence without advancing the period.

New accounts may optionally provide a broad experience estimate or a known Go
rank. `starting-strength-v1` maps that claim to the initial rating with RD 350.
The claim is immutable, is applied once before any rated game, and cannot later
rewrite an established rating. Accounts are provisional for their first ten
rated games. Rank labels are derived display values under `gostone-rank-v1`;
the numerical Glicko-2 state remains authoritative.

Guests enter `guest-unrated`; registered accounts enter `registered-rated`.
The pools never cross. A queue row snapshots the exact rules tuple, global
rating and RD, algorithm and matchmaking policy versions, player preferences,
and any server-supported quality signals. `adaptive-global-glicko-match-v1`
widens the rating window with wait time and uncertainty, while blocks,
restricted abandonment risk, and configuration differences remain hard
exclusions. Handicap remains review-only until the game rules support it.

Bot fallback is an explicit account preference. Registered matchmaking never
falls back to a heuristic unrated bot: without an accepted calibrated profile,
the player remains queued for an eligible human. A bot can affect rating only through an immutable
`calibrated-bot-profile-v1` profile with accepted reproducible evidence,
append-only activation, exact per-game binding, and per-action execution
identity. The fixed profile rating and RD are the only opponent inputs;
`game_bots.target_rating` is execution difficulty and is never rating evidence.
No calibrated profile is seeded by migrations, so rated bot play remains
fail-closed until real calibration evidence is separately approved.
