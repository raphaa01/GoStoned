# Web analytics

`/webanalytics` is an unlinked, HTTP Basic protected, no-store admin report.
Existing `WEB_ANALYTICS_ADMIN_USER` and `WEB_ANALYTICS_ADMIN_PASSWORD_SHA256`
protect the page. Do not expose these or the API token through public variables.

Enable Vercel Web Analytics for the GoStone project and configure these server
environment variables in Production:

- `WEB_ANALYTICS_VERCEL_TOKEN`: a Vercel access token scoped to the owning team
  (and project if supported).
- `WEB_ANALYTICS_PROJECT_ID`: the linked GoStone project ID.
- `WEB_ANALYTICS_TEAM_ID`: the owning team ID.

Redeploy after configuring environment variables. CLI OAuth access cannot create
access tokens; use Vercel Account Settings → Tokens if token creation returns 403.
Never copy the CLI login credential into the application.

Traffic comes from Vercel's public Web Analytics API. Today, 7-day and 30-day
windows use UTC. Window visitor totals come from an environment aggregation;
they must not be calculated by adding daily or country visitor counts. Lifetime
totals come from the count endpoint. Requests filter production and exclude the
admin route. Missing credentials, limits and API errors display an unavailable
message independently of business and engagement reports.

The public API supports country, path, route, referrer, device, browser and OS
breakdowns. It does not expose session duration or bounce rate. UTM query data
is deliberately removed before sending traffic; UTM reports require Analytics
Plus, and Vercel custom events require Pro or Enterprise. No plan upgrades are
performed by this implementation.

## Visible time

Migration `051_web_analytics_engagement.sql` adds anonymous hourly counters by
known, redacted page path. Apply it with the existing `npm run db:migrate`
workflow before production deployment. All connections use `lib/db.ts` and
`DATABASE_URL`. The table denies access to public, anon and authenticated roles;
only the server application role can read or update it.

The client sends a view-start counter and then visible milliseconds every 30
seconds, on page changes, pagehide and visibility changes. Hidden time is not
counted. BFCache restores resume timing without counting another view. Requests
omit credentials and store no cookies, browser storage, account, visitor or
session IDs. Do Not Track disables this extra measurement. Paths are restricted
to known GoStone pages; game, review and shared-link identifiers are redacted.
Production ignores preview submissions. The endpoint validates the origin,
caps the JSON body and elapsed time, and uses an ephemeral IP rate limiter.

These are client-reported aggregate estimates, not an audit trail. Failed,
blocked, delayed, pending, or forged requests can affect counters. Mean visible
time divides milliseconds by recorded view starts in the same UTC window.
Visits crossing a window boundary can contribute time without a start. Vercel
pageviews and measured view starts use different collection mechanisms and can
differ. Historical time data cannot be reconstructed.

Visible-time reports have an independent `engagement=1|7|30|all` selector.
`all` reads every stored hourly counter through the current time, without a
lower time bound. Traffic remains limited to its existing today/7/30-day windows.

## Website reviews and price survey

The protected page also reads `game_analysis_jobs` and `analysis_price_votes`
through `lib/db.ts` in separate read-only repeatable-read transactions. No
additional tracking, database tables, cookies or Vercel paid events are needed.

Server review requests, first recorded execution starts and completions are
counted by their own timestamps in the selected traffic window (UTC). The report
also shows all-time request/start totals, current queue/running counts, distinct
requesters and the latest 20 requested jobs with dates, status and attempts.
Native mobile reviews use local IndexedDB/native KataGo and never write server
review jobs. Browser bot turns and puzzle generation are separate systems.
The website dispatches these server reviews to Modal; this report is not a
provider billing or worker-call ledger. Reopening a cached review does not create
a job. Failed jobs can be reused and their timestamps/attempts reset, so old retry
history cannot be reconstructed from the current row.

Price votes are one current choice per account (3/5/8/12 EUR monthly). Reports
show all-time participants, distribution including zero-count choices, average
chosen price, participation against all registered accounts, new participants
and current answers last saved in the selected traffic window. The latest 20
answers show first-vote and last-save times without account identifiers. A
changed choice replaces the previous answer; saved answers are not a tally of
all clicks and are not purchases. Deleted account votes disappear with the
existing cascade, so the report reflects currently retained answers.

References:
- https://vercel.com/docs/analytics/web-analytics-api
- https://vercel.com/docs/analytics/privacy-policy
- https://vercel.com/docs/analytics/custom-events
