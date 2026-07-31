# GoStone privacy-policy release checklist

The public policy at `/privacy` reflects the data flows currently implemented in
this repository: Vercel hosts the Next.js application, Supabase hosts PostgreSQL,
and Modal runs the production KataGo worker. Re-check and update the policy before
deployment if any of those facts changes.

## Required before a public launch

1. Configure the real controller details through the existing `LEGAL_*`
   production environment variables. The privacy page uses the same name,
   serviceable address, representation, and monitored email address as the legal
   notice. Never commit those personal details.
2. Execute and retain the data-processing agreements offered by Vercel,
   Supabase, and Modal. Record the current subprocessors and the transfer
   safeguards relied on for processing outside the EEA.
3. Record the selected Supabase project region, Vercel plan and log retention,
   Supabase log and backup retention, and Modal compute region and plan in the
   internal processing register. The public wording deliberately states the
   applicable maximum or retention criterion where the repository cannot know a
   deployment plan.
4. Establish an operational process for access, correction, export, objection,
   and deletion requests sent to `LEGAL_EMAIL`. Account deletion is currently an
   operator-managed request, not a self-service user interface.
5. Define and perform necessity reviews for stored account/game history, chat,
   analysis results, and any enabled player reports. Do not promise a fixed
   deletion period unless the corresponding cleanup is implemented and tested.
6. Link the public `/privacy` URL in any mobile-app store listing or native app
   that uses the same data flows. Update the policy before a native app adds
   device permissions, push notifications, advertising identifiers, crash SDKs,
   or other processing not listed here.

## Changes that require a policy and consent review

- analytics, advertising, attribution, session replay, or cross-site tracking;
- external fonts, video embeds, social widgets, or other third-party browser
  requests;
- email collection, password recovery, newsletters, payments, or support tools;
- a new hosting, database, logging, monitoring, or AI provider;
- a new public profile field or a change to leaderboard visibility;
- enabling player reports without the operational controls in
  `docs/player-reporting.md`;
- a material change to retention, automated decisions, or international data
  transfers.

The current implementation uses only the three first-party cookies documented on
the page. Under Section 25(2)(2) TDDDG, those cookies are limited to the requested
authentication, guest-play, and language functions. If an optional browser or
device technology is introduced, obtain any required consent before activating
it; a privacy-policy update alone is not consent.

## Primary and provider sources

- [Articles 5, 6, 12, 13, 14, 15–22, 28, 32, 44–49 and 77 GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [Section 25 TDDDG](https://www.gesetze-im-internet.de/ttdsg/__25.html)
- [Vercel Data Processing Addendum](https://vercel.com/legal/dpa)
- [Vercel runtime-log retention](https://vercel.com/docs/logs/runtime)
- [Supabase Data Processing Addendum](https://supabase.com/legal/dpa)
- [Supabase regions](https://supabase.com/docs/guides/platform/regions)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Modal Data Processing Addendum](https://modal.com/legal/dpa)
- [Modal security and data retention](https://modal.com/docs/guide/security)

This implementation provides a technically accurate disclosure baseline. The
configured production version and the operator's actual organizational
procedures should be reviewed by qualified counsel before a commercial or
monetized launch.
