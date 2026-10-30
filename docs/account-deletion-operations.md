# Self-service account deletion

Website, iOS and Android use the same authenticated deletion API and shared
confirmation form. Open Profile → Settings → Delete account, confirm permanent
deletion, and submit. The public `/delete-account` page runs the same flow and
links directly to existing-account login with a return path to deletion.
No support contact, added email, local password, or new registration is required.
The legacy missing-email screen also offers deletion directly.

## Deploy

Apply `056_self_service_account_deletion.sql` using the numbered migration
runner before deploying this API. The production build preflight checks it.
`ACCOUNT_DELETION_REQUESTS_ENABLED` is obsolete: deletion is always available.
Rebuild and publish both native clients to expose the updated settings form;
merging server code does not update already installed app bundles.

Deletion runs in one database transaction. It ends active games with the existing
resignation/time/rating rules, validates their rating evidence, then erases the
user, provider identities, all sessions, password resets, friendships and their
messages/invites, game chat, blocks/reports, learning/puzzle progress, preferences,
live ratings, old personal rating history, statistics, price votes and owned
share links. OAuth registration intents and native handoffs for linked identities
are removed. Guest profiles follow the same personal-data cleanup.

Shared game records and immutable rating/bot/scoring evidence keep random internal
player keys, but no username, email, password, provider subject or profile mapping.
They preserve the opponents’ game history and rating integrity. Do not describe
these records as irreversibly anonymous: an opponent may remember a shared game.
The rating event insert/commit and immutable mutation guards remain enabled;
historical events no longer require the departing player's current rating row.
Initial claims are erased through their existing post-user-delete cascade exception.

The completed receipt has no identity/contact, only a random reference and dates.
An HttpOnly, purpose-limited receipt cookie permits checking success after all
sessions are revoked. It expires after 30 days; reads reject older receipts and
submissions remove old completed receipts in bounded batches. The existing
`npm run deletion:requests -- purge-completed` command can also purge them.
Legacy pending requests remain available to their owner; confirming now completes
the deletion automatically. No optional confirmation email is collected or sent.

## Sign in with Apple

New Apple code exchanges store an AES-256-GCM encrypted refresh token, bound to
the provider subject. Encryption derives a separate purpose-specific key from the
existing server-only `APPLE_PRIVATE_KEY`; no new secret is needed. Tokens never
enter browser/native responses or handoffs. Deletion revokes stored tokens through
Apple's REST API before erasure. Provider errors leave the transaction uncommitted
and the form retryable. Repeated revocation of an already revoked token is safe.

Before rotating `APPLE_PRIVATE_KEY`, re-encrypt stored revocation tokens using the
old and new keys; replacing it without migration makes existing ciphertext unreadable.
Legacy accounts created before this change have no recoverable provider token.
They are still deleted without requiring sign-in again or a password; GoStone
cannot programmatically revoke a token it never retained. The completion page
explains the optional Apple authorization removal for those accounts.

Abandoned Apple sign-ins without an account are eligible for token cleanup after
one day; later Apple exchanges remove expired unclaimed credentials in bounded
batches. Keep the provider-specific account identifier/token retention disclosed.

## Verification

`npm test` covers session-bound authorization, explicit confirmation, native
origins, receipt privacy, rollback, legacy missing-email accounts, and authenticated
encryption/revocation. Browser tests exercise confirmation, cancellation, failure,
retry and signed-out completion in Next.js and the shared iOS/Android bundle.
`scripts/smoke-account-deletion.ts` runs against an explicitly isolated PostgreSQL
database in CI to verify real cascades, rated games, surviving opponent evidence,
session invalidation and immutable guards. Never use production accounts for it.

Backups expire under the provider's configured rolling cycle. Any restoration
procedure must reapply completed erasures before restoring normal service.

References: [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/),
[Apple token revocation](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple),
[Google Play deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).
