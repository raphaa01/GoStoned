# GoStone tournaments

## Monthly Rapid

- The last seven calendar days of each month, 00:00 UTC through 00:00 UTC
  on the first of the next month. Registration is voluntary and opens earlier.
- At least ten completed rated games, using the global Glicko-2 game count.
- Four categories, frozen on entry: below 1000, 1000–1499, 1500–1999, 2000+.
  Each entrant receives a stable leaderboard group of up to 24 players, assigned
  on entry. A final overflow group can be smaller. Groups affect ranks and
  trophies, while all available players in a category share one queue.
- Up to ten games per player on 13×13 with Rapid time and 6.5 komi.
  App and website entrants use the same rated queue. Pairing prefers the same
  rank at registration and then the closest rating within the category.
  Players request a game when available; a pairing requires two live queue leases
  and a separate ready confirmation from each player before clocks start.
- No repeat opponents. If nobody is available, the player can leave the queue
  and return later. We never invent an opponent or silently change categories.
- Standings sort by wins, then by total signed score margin from games that
  ended in scoring. Resignations and timeouts count as wins/losses with zero
  margin. Exact ties share a place. Players with no completed games rank last.
- Podium finishers with at least one completed game earn a trophy. Career Rapid
  points are (4 − place) × (category + 1). The global and friends lists use the
  same points, including historical Rapid trophies.
- Completed events keep their original results. New Rapid and private finishes
  save final standings for the history view. Profile tournament wins count
  first-place monthly trophies and winning finishes in private tournaments.
- Only games completed before the deadline count. Games already running may
  finish normally and still affect ratings. Final results and trophy awards are
  reconciled transactionally on the next tournament/profile request; no open
  browser, paid worker, cron setup or permanently running process is required.

The queue approach borrows the availability-based pairing of Lichess arenas,
with a ten-game cap instead of speed/grinding bonuses:
https://lichess.org/tournament/help?system=arena
Swiss rounds wait for all players and are less suitable for a week-long event:
https://lichess.org/swiss

## Monthly Classic

- Requires ten rated games and an automatically derived GoStone rank of 10 kyu
  or stronger (rating >=1500). Strength category and rating freeze on entry.
- Separate registration from Rapid; a player may join both. One Classic slot per
  month. Choose 08:00, 16:00 or 20:00 UTC daily; all five dates are shown in the
  browser's local timezone, including timezone abbreviations and DST changes.
  Confirm availability for all five rounds. Registration closes at the first
  advertised start; leaving is allowed before then. No late entry.
- Five consecutive daily rounds start during the last week, on days 1–5 of that
  window, leaving two buffer days. 19x19, Japanese 6.5, 60 minutes per player plus
  three 30-second Japanese byoyomi periods. Existing private/normal Classic
  remains 20 minutes; the authoritative game clock stores the monthly settings.
- Each category/slot needs at least six entrants, otherwise it is cancelled
  without penalty. Balanced fields of 6–32 are frozen at start (33 entrants form
  fields of 17 and 16). Fields stay independent for opponents, ranks and trophies.
- Fields up to ten use a circle schedule to guarantee distinct opponents across
  five rounds. Larger fields use score-first Swiss pairings, avoiding repeats
  and balancing colors, with a lowest-score bye that rotates. After withdrawals,
  a repeat is allowed only if a no-repeat matching is impossible. This is not
  a claim to implement every EGF McMahon rule; categories start on equal scores.
- A round appears at its fixed start. Both players must press Ready by start +
  five minutes, then clocks start. One present player wins by forfeit; if both
  miss, both receive zero points and a loss. No game/rating event is invented.
  Merely opening the page does not confirm attendance. Personal block lists
  do not change scheduled competition opponents; chat moderation still applies.
- First missed check-in: warning. Second within the same event: withdraw from
  the remaining rounds and block **only next calendar month's Classic**. Rapid,
  private tournaments and normal games remain available. Each expired pairing
  records attendance exactly once, including rejected late check-ins. Byes,
  cancellation and pre-start withdrawal never produce strikes.
- Withdrawn players cannot receive trophies; their scheduled small-field
  opponents get byes. Wins, draws, losses and opponent-point ties otherwise use
  the same ranking rules as Rapid. The top three per field receive distinct
  Classic profile trophies after five completed rounds (byes/forfeits count),
  provided they completed at least one actual game. Exact ties share a place.
- Progression and attendance are reconciled from authoritative timestamps on
  detail, dashboard, global website-notice and profile reads. A late request
  never shifts a round's five-minute deadline. If a previous round overruns the
  next fixed start, the event is cancelled without new attendance penalties;
  its running games may finish normally. No paid worker or always-on process.

Pairing/background reference: British Go Association tournament handbook:
https://www.britgo.org/organisers/handbook/tournament4

## Private

- Code or an invitation from the host; 2–32 players, 9×9/13×13/19×19,
  Blitz/Rapid/Classic, round robin or single elimination. Always unrated.
- Shared lobby and standings. Only the host can edit settings and start/cancel.
  Settings and participants freeze at start. One concurrent game per player.
- Round-robin uses a circle schedule with byes. Knockout pairs survivors each
  round. All pairings in a round become available together.
- Both players press Ready before a game is created. The ready window is two
  minutes. A ready player wins against a no-show; two no-shows receive no points
  and are eliminated in knockout. Forfeits never affect ratings.
- Waiting/finished players can watch tournament games with read-only controls.
  The next pairing is announced across website pages; finished games return
  players automatically to the lobby. Standings show points, wins, losses, draws
  and completed games.
- Hosting is temporarily open. `tournament_settings.premium_hosting_enabled`
  switches on a server-side entitlement check against
  `tournament_host_entitlements.premium_until`; joining stays independent.
  Billing can grant this entitlement later without changing tournament logic.

## Persistence and safety

Migration 060 is additive and must be applied before the website release. Keep
Classic disabled and retain the old uniqueness target during rollout. Once the
new production build is READY, apply 061 to remove the legacy uniqueness target
and enable Classic. Fresh/test databases apply the full chain in order. All database access
uses `lib/db.ts`. Tournament row locks serialize capacity, settings, round
progression, queue matching and trophy awards. Game creation also takes the
existing `active-game-player:v1:` locks and checks active games and matchmaking
queues. Membership, eligibility, host rights, account binding, origin, moderation
restrictions, blocks and request limits are checked on the server.

The shared iOS and Android app client displays Monthly Rapid and private
tournaments. Monthly Classic registration is on the website. Apply additive
migration 062 before deploying the updated API.
