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

## Implementation status

Account email and the legacy-account gate are implemented. Password recovery has
a shared client form and database service, but **the password-reset HTTP route
and real email sender still need to be added after provisioning Resend**.
Do not merge or release this draft until that remaining boundary is implemented.

The intended flow sends an eight-digit random code valid for ten minutes, stores
only a salted scrypt hash, allows five wrong attempts, and replaces a code at most
once per minute. A successful reset consumes the code and revokes all account
sessions in one transaction. OAuth-only accounts do not receive local reset
codes. Public request responses must remain identical for known and unknown
addresses, including delivery failures.

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

Resend provisioning for the existing Vercel project is blocked by the owner's
acceptance of the marketplace/provider terms. Planned resource: free plan,
`gostone.app`, `eu-west-1`. After acceptance, install the resource, verify the
sending domain, configure a monitored sender, and implement the HTTP sender from
the provisioned provider instructions. Keep credentials server-side and untracked.
Update the privacy policy with the actual processor and recovery retention
details when the sender is integrated.

Validation:

- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`
- `npm run mobile:typecheck`, `npm run mobile:build`
- Browser coverage in `tests/browser/account-security.spec.ts`
- CI PostgreSQL coverage in `scripts/smoke-account-security.ts`, including code
  expiry, attempts surviving commit, resend/redeem concurrency, and revocation
