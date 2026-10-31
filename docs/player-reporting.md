# Community reporting and moderation

Owner: **rapha**, explicitly appointed by the product owner. Migration 057 resolves that existing account once into `moderation_moderators.user_id`. All authorization thereafter uses the immutable account ID and a live membership check, never a username, DEV badge or client role. Deleting/recreating a handle does not confer access.

## Release and access

Apply numbered migration `057_community_moderation.sql` with `npm run db:migrate` before deployment. Production preflight rejects a missing schema. New installations enable reporting by default; `PLAYER_REPORTING_ENABLED=false` is the emergency switch for game report intake. Remove any old false setting when launching. Both native clients require rebuild/sync and a new signed store build; a server merge cannot update installed bundles.

Rapha opens Profile → Settings → Moderation. The same panel works on web, iOS and Android. Nonmoderators receive no navigation link; every server page/API/service authenticates independently. The runtime database role cannot provision moderator memberships. An authorized database operator may revoke a UUID by deleting its membership; the next request loses access. No credentials belong in Git.

## Player flow

- A small Report action sits beside Block in the game chat and friend chat. Category is the only report payload. The server derives the target from the actual game/friendship; outsiders cannot report or inspect that conversation.
- Reports are private and idempotent per source and reporter (friend chats also bind the current message cursor so later abuse can be reported again). A lost response can be retried; the first report/category remains authoritative. A report itself never changes results or ratings.
- Password and social sign-up require a short, unchecked rules checkbox before creating a public username. Consent is recorded in the same registration transaction. Existing accounts and guests accept once before their next message; normal turns are unaffected. The backend refuses messages without the current consent version.
- Privacy, rules and contact remain reachable before sign-in in both native apps. Rules open on demand without discarding registration fields.

## Daily handling

Rapha checks the queue daily and gives threats, sexual exploitation and child-safety reports first priority (the queue sorts these first). Review the relevant messages before deciding. For credible immediate danger use appropriate emergency channels; preserve only necessary evidence and handle lawful disclosure requests through the published contact. Do not promise an emergency response or a fixed response time in player copy.

Decisions are Close without action, Remove chat, or Suspend for 7 days. Removal closes the offending conversation to both participants and clears their next chat snapshot; the Go game remains playable. Suspension prevents new queue entries, new friend requests/invites and chat. Active games, account access, privacy/deletion and reports remain accessible. Decisions and appeals are audited, server-authorized transactions. Repeated submissions cannot repeat enforcement or extend a suspension.

An appeal or data request uses the contact published at `/impressum`. In Closed reports, review the original conversation and choose Lift action if appropriate. Lifting a decision restores retained chat and removes only a restriction attributable to that case; it does not remove a player's personal block. No automatic rating reversal or automatic punishment based on report volume exists.

## Retention and deletion

Consent stores only player key, policy version and acceptance time, and is erased with the identity. Reports store source, category, participant keys and timestamps. Messages remain in their existing protected conversation tables; no extra transcript copy or free-text report is retained. Chat removal uses a moderation timestamp so evidence can be reviewed during appeal. At triage processing, bounded cleanup deletes removed messages older than 90 days and closed cases/decisions/audit records older than 180 days. Open cases require necessity review during the daily queue check; they are not silently discarded by a timer. These are cleanup eligibility criteria, not a promise that an unattended job runs at an exact second.

Account/guest deletion removes corresponding new cases, decisions, audit records, consent and messages. Guest session expiry alone preserves the existing report-evidence behavior. Inspect subject-access/export requests only after ownership verification and disclose no other player's private data. No report content is sent through email or third-party AI.

## Verification

`npm run typecheck`, `npm test`, `npm run build`, `npm run mobile:typecheck`, `npm run mobile:build`, focused browser/mobile tests, and `npx tsx scripts/smoke-community-moderation.ts` against an explicitly identified disposable local PostgreSQL database. The integration smoke covers consent bypasses, unauthorized triage, first-write-wins reports, concurrent decision retries, chat removal, temporary restriction, appeal, friend blocking, RLS and erasure.

Android native builds now request 16-KB page alignment and reject every output engine whose ELF LOAD segments fail validation. Verify the packaged APK/AAB too; browser tests do not test an iPhone or 16-KB physical Android hardware.
