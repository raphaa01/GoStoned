# Password accounts and recovery

Password registration requires a username, password, and normalized email address.
Registration does not send a verification code. Login accepts username or email,
using the same account-wide rate-limit budget for both aliases.

Existing password accounts without a local email can still authenticate. Their
session exposes `emailRequired`; the shared web/mobile AuthProvider replaces
account content with the email form and a logout button. Protected APIs reject
these accounts with `email_required`, including when a guest cookie also exists.
Only these incomplete password accounts can use `POST /api/auth/email`; the
operation cannot replace an existing address.

Google and Apple identities remain keyed by provider and subject. Their email
addresses stay on `auth_identities`. No account is linked by matching email, and
no social account is required to add a local address. Apple private relay
addresses and callbacks without an email keep their existing behavior.

## Password recovery

`POST /api/auth/password-reset` accepts `{action: "request", email}` or
`{action: "reset", email, code, password}`. Both mutations enforce origin and
bounded JSON bodies. Requests are limited by IP and normalized email, even for
unknown addresses. Issuance and delivery run through Next.js `after` so account
lookup and provider latency do not affect the public request response.

The flow sends an eight-digit random code valid for ten minutes, stores
only a salted scrypt hash, allows five wrong attempts, and replaces a code at most
once per minute. A successful reset consumes the code and revokes all account
sessions in one transaction. OAuth-only accounts do not receive local reset
codes. Public request responses must remain identical for known and unknown
addresses, including delivery failures.
Session issuance rechecks the password under the same user lock as recovery,
preventing an in-flight login with the old password from surviving a reset.
Expired hashes are removed in bounded batches during subsequent issuance;
expiry is enforced even before cleanup.

## Deployment and validation

Apply numbered migration `054_account_email_and_password_reset.sql` using
`npm run db:migrate` before releasing the application. Do not execute destructive
smoke tests against production. The migration preserves existing users, password
hashes, provider identities, sessions, and game history. Production builds check
that the new storage is present before deploying.

The bundled iOS/Android client must also be rebuilt and released before enforcing
this policy for existing app installations. Older app bundles cannot display the
new gate or submit the new email field. The shared client build has been checked;
device testing, signing, and App Store/Play Store distribution are separate release
steps and have not been performed in this draft.

Resend is provisioned through Vercel Marketplace on the free plan for
`gostone.app` in `eu-west-1`. Its DKIM and SPF records are verified. The integration
supplies server-only `RESEND_API_KEY` and `RESEND_EMAIL_DOMAIN` in production,
preview, and development. The sender is `GoStone <security@gostone.app>`; this is
a transactional sending address, not a support inbox. No SDK is required.
Provider failures never expose recipient addresses, codes, or response payloads.
The sender has a 15-second timeout and an idempotency key. Open/click tracking is
disabled. The privacy policy discloses Resend, its 30-day content/log retention,
and possible US processing. See https://resend.com/security/gdpr.
Real-provider validation uses `delivered@resend.dev`, Resend's simulated test
recipient, so no unrelated person receives test email.

Validation:

- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`
- `npm run mobile:typecheck`, `npm run mobile:build`
- Browser coverage in `tests/browser/account-security.spec.ts`
- CI PostgreSQL coverage in `scripts/smoke-account-security.ts`, including code
  expiry, attempts surviving commit, resend/redeem concurrency, and revocation
