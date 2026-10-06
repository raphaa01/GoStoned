# In-app account deletion requests

## Release gate

`ACCOUNT_DELETION_REQUESTS_ENABLED=true` enables the authenticated in-app
request flow for accounts and guest profiles, including the bundled native
settings page. It is disabled by default. Migration
`049_account_deletion_requests.sql` must be applied before enabling it.

The operator agreed to complete requests within seven days. Retries preserve
the original deadline. An optional email can receive confirmation; users who
leave it blank can check the private receipt in the app after session removal.
The receipt cookie is HttpOnly and reveals only request status and dates.
Completion removes the queue's player key and email. Completed receipts are
available for 30 days and must then be purged by the operator.

**Do not enable the flow or submit the iOS app yet.** This change records
requests; it does not implement data erasure. The immutable initial-rating
claims and rating-event foreign keys currently prevent a simple account
DELETE. A reviewed, tested erasure/anonymization procedure is still required.
Never disable the immutable rating triggers to bypass that problem.

## Before enabling

1. Define and test erasure for a fresh account, an Apple/Google account, a
   guest profile, and a rated account with chat, games, learning progress,
   puzzle progress, friends, reports, votes, and analysis. Preserve other
   players' game integrity without retaining the departing player's identity.
2. Test session invalidation, pending OAuth registration/handoff cleanup,
   Sign in with Apple token revocation, and the post-deletion receipt.
   Apple provider tokens are not currently retained, so the revocation flow
   needs a deliberate implementation. Do not assume deleting a local identity
   revokes Apple's authorization.
3. Update the public privacy policy for the optional confirmation email,
   private queue, seven-day commitment, necessary receipt cookie, and 30-day
   completed-receipt retention. Add Customer Support, linked to identity and
   used for App Functionality, to Apple privacy disclosures and the native
   privacy manifest before enabling this support flow.
4. Establish daily monitoring, a backup operator, and escalation before a
   deadline is missed. Test a synthetic request end to end, including receipt
   confirmation and email delivery when an email is supplied.
5. Deploy the API and migration, enable the gate only after those checks,
   rebuild the native bundle, and verify the actual release on a device.

## Daily operator checklist

Use an authorized terminal with `DATABASE_URL` securely configured. All
connections go through `lib/db.ts`. No public administrator endpoint exists.

```sh
npm run deletion:requests -- list
```

This prints private account identifiers and optional confirmation addresses.
Do not paste its output into chats, logs, Git, or App Review notes. Check the
oldest deadline first. The in-app authenticated request already verifies
ownership of the requesting account or guest profile. Email-only requests
still require an appropriate ownership check; never request passwords.

Apply the reviewed erasure procedure, revoke access, handle any justified
retention explicitly, and email completion when an address was supplied.
Record completion only after all of that work is done:

```sh
npm run deletion:requests -- complete <request-uuid> \
  --confirm-data-erased --confirm-access-revoked --confirm-notified
```

Without an email, `--confirm-notified` means that completion will be confirmed
by the in-app receipt. The command refuses completion while the account or
guest session still exists. It does not delete accounts and cannot prove that
all associated data was erased; the operator must attest truthfully.

Run the following daily to remove expired, already de-identified receipts:

```sh
npm run deletion:requests -- purge-completed
```

Backups expire under the provider's documented retention cycle. Record any
restoration procedure that re-applies erasures, so deleted personal data does
not silently reappear after recovery.
