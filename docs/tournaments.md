# Website tournaments

## Monthly

- The last seven calendar days of each month, 00:00 UTC through 00:00 UTC
  on the first of the next month. Registration is voluntary and opens earlier.
- At least ten completed rated games, using the global Glicko-2 game count.
- Four categories, frozen on entry: below 1000, 1000–1499, 1500–1999, 2000+.
  There are no small isolated groups: all available players in a category share
  a queue. No bots, fixed appointments, streak bonuses, or unlimited grinding.
- Five games per player; 13×13, Rapid, Japanese rules. Monthly games are rated.
  Players request a game when available; a pairing requires two live queue leases
  and a separate ready confirmation from each player before clocks start.
- No repeat opponents. If nobody is available, the player can leave the queue
  and return later. We never invent an opponent or silently change categories.
- Wins = 1, draws = ½, losses = 0. Tiebreak: sum of opponents' points, then wins.
  Exact ties share a place. All five completed games are required for a podium
  trophy; unfinished runs follow qualified players in the final standings.
- Only games completed before the deadline count. Games already running may
  finish normally and still affect ratings. Final results and trophy awards are
  reconciled transactionally on the next tournament/profile request; no open
  browser, paid worker, cron setup or permanently running process is required.

The queue approach borrows the availability-based pairing of Lichess arenas,
with a five-game cap instead of speed/grinding bonuses:
https://lichess.org/tournament/help?system=arena
Swiss rounds wait for all players and are less suitable for a week-long event:
https://lichess.org/swiss

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

Migration 059 must be applied before the website release. All database access
uses `lib/db.ts`. Tournament row locks serialize capacity, settings, round
progression, queue matching and trophy awards. Game creation also takes the
existing `active-game-player:v1:` locks and checks active games and matchmaking
queues. Membership, eligibility, host rights, account binding, origin, moderation
restrictions, blocks and request limits are checked on the server.

Only website routes/navigation are introduced. No native routes, store builds,
native assets or app release are part of this change.
