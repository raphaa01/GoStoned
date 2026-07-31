# Adaptive matchmaking and rated-bot domain policies

## Scope and activation status

This document covers pure, versioned domain contracts only. It does not change
the matchmaking service, schema, database, routes, UI, rules catalogue, rating
writer, or game lifecycle. No rated bot profile is active: the repository has no
production profile or calibration evidence registry. Test fixtures demonstrate
the acceptance contract but are not calibration evidence and must never be
deployed as such.

Activating these policies requires later transactional integration, audited
calibration artifacts from real reproducible runs, and an explicit operational
decision. Until then, current production matchmaking and human rating behavior
remain unchanged.

## Adaptive human matchmaking v1

`adaptive-global-glicko-match-v1` evaluates and ranks candidates without
querying or mutating storage. The caller supplies the current time and a
direction-independent block result; the policy does not infer either.

Hard eligibility boundaries are:

- the same player cannot match itself;
- `guest-unrated` and `registered-rated` pools never mix;
- board size, time control, rules, rules profile/version, scoring method, komi,
  and handicap must all match exactly;
- a block in either direction excludes the pair;
- a restricted abandonment state excludes the pair; and
- registered players must fit the adaptive rating window.

The registered-player base window starts at 100 rating points, widens by 20
points per longest-wait minute, and caps at 500. A separate uncertainty
allowance is 35% of the two rating deviations combined and caps at 200. Rating
deviation widens compatibility but is never treated as another rating. Guests
carry no rating or rating deviation and stay in their separate unrated pool.

The score combines rating fit, optional reliable latency, abandonment quality,
longest-wait priority, and handicap preference. Missing reliable latency is
neutral rather than fabricated. Elevated abandonment risk lowers rank;
restricted risk remains a hard exclusion. Mutual verified-handicap preference
may produce `verified-handicap-review` for a large rating gap, but this policy
never changes handicap or creates a game. The downstream exact rules and
handicap authority must approve any such game.

## Calibrated bot profiles v1

`calibrated-bot-profile-v1` binds a transparent bot identity to exact engine,
model, and configuration versions; exact supported game configurations; and one
fixed rating and rating deviation. `bot-opponent-binding-v1` snapshots those
values and a SHA-256 profile fingerprint as `fixed-versioned-profile` credit.
There is deliberately no per-game bot rating update field.

Nearest-profile selection considers both the human/bot rating difference and
their rating uncertainty. It considers only profiles whose evidence passes the
acceptance gate, requires an exact supported board/time/rules/komi/handicap
configuration, and respects even-only versus verified-handicap preference.
Deterministic profile IDs break equal-distance ties.

Execution credit fails closed unless the actual profile, engine, model, config,
fixed rating, fixed deviation, and fingerprint all match the bound opponent.
Bots are explicitly excluded from both human-only statistics and the registered
human rated population. Guests are human but remain outside the registered rated
population.

## Calibration acceptance gate v1

`bot-calibration-acceptance-v1` rejects missing evidence. A candidate artifact
must bind the exact profile and policy versions and provide:

- the exact profile fingerprint, a full 40-character source revision;
- SHA-256 dataset and runner digests;
- a non-empty reproduction command;
- at least 500 games, including at least 100 holdout games and 100 distinct
  registered human opponents, with neither subset count exceeding total games;
- exact, unique coverage for every supported configuration, at least 50 games
  per configuration, with coverage totals reconciled to the full sample;
- a standard error no greater than 75 rating points;
- a fixed rating supported by the estimate and a fixed rating deviation that
  does not understate the standard error; and
- zero unresolved audit findings.

Passing this pure decision does not itself activate a profile. Activation still
needs independently reviewed artifacts, a durable registry and audit trail,
transactional game/opponent binding, rating-policy approval for bot games, and
operational monitoring. None of those artifacts or approvals exists in this
change, so rated bots must remain off.

## Provider-neutral move boundary v1

`provider-neutral-bot-move-v1` defines only move generation. It does not share
or duplicate the KataGo scoring adapter and grants a provider no game authority.
The canonical SHA-256 request identity binds the game, exact position and
complete move history, rules configuration, versioned bot profile binding,
deadline, and retry budget. Caller-owned arrays and profile data are copied and
frozen before provider execution.

`bot-move-deadline-retry-v1` allows one through three attempts under one total
10–30000 ms deadline. Only `provider_unavailable` retries. Invalid, stale,
unbound, aborted, and timed-out results terminate with stable codes; an exhausted
retry budget returns `retries_exhausted`. Caller cancellation and deadline expiry
settle even if a provider ignores its abort signal.

The boundary accepts pass/resign or an in-bounds empty point. That is transport
validation, not Go legality. The authoritative game service must re-check the
current game revision, turn, clock, superko, suicide, handicap/setup state, and
all other rules before committing a move. `DeterministicBotMoveProvider` is the
zero-network test double and must not be mistaken for a calibrated production
profile.
