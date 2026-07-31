# Player reporting release gate

GoStone's private report intake is a protected backend foundation. It is not a
complete moderation workflow and must not be presented to players until the
operational ownership below is in place.

The server gate is closed by default. The endpoint returns the same private
not-found response without reading identity, body, rate-limit, game, or report
state unless `PLAYER_REPORTING_ENABLED` is exactly `true`. Do not set this
environment variable until every enablement requirement below is satisfied.

## Stored intake contract

- One immutable, first-write-wins report per game and reporter.
- The reported participant is derived from the stored game. Clients cannot
  submit or receive a target identity.
- The fixed category is the only user-selected report data. The intake stores
  no free text, transcript copy, IP address, user agent, contact details,
  credentials, moderator state, or enforcement outcome.
- A report has no automatic effect on the game, rating, chat, block state, or
  matchmaking.
- Reports are protected by row-level security and revoked direct access.
- Reports deliberately survive guest-session expiry and block removal.
- Game deletion is restricted while report evidence exists.

## Required before exposing a player-facing report action

1. Name the person or team responsible for triage and escalation.
2. Establish least-privilege moderator authentication and an auditable way to
   inspect reports without granting direct public, `anon`, or `authenticated`
   table access.
3. Approve retention, deletion, subject-access, appeal, and law-enforcement
   handling with the product/privacy owner. No automatic cleanup is claimed by
   the current implementation.
4. Define severity routing for threats, sexual or child-safety concerns,
   abusive conduct, fair-play concerns, stalling, scams, and identity abuse.
5. Define truthful player copy. Do not promise a response time, human review,
   enforcement, rating reversal, or an appeal process before it exists.
6. Add the bilingual accessible UI, targetless status reconciliation, browser
   tests, and an operational smoke test before enabling the control.

Production deployment, database migration, enabling
`PLAYER_REPORTING_ENABLED`, triage access, and retention changes require
separate authorization. The report endpoint must remain disabled and unlinked
from the player interface until these gates are satisfied.
