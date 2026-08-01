# KataGo scoring boundary

## Scope

GoStone treats KataGo as an untrusted suggestion provider. KataGo never confirms
a player proposal and never computes the authoritative Japanese result. The
Japanese rules service must validate the agreed or adjudicated complete
dead-group set and compute territory, prisoners, komi, and outcome itself.

Every adapter implements one `KataGoScoringProvider` contract. Production can
reuse GoStone's existing authenticated, scale-to-zero KataGo job infrastructure:

- `ModalKataGoScoringProvider` durably inserts the immutable request, dispatches
  the existing Modal `analysis` job, and polls the database for its result.
- `LocalWorkerKataGoScoringProvider` uses the same durable queue for the local
  long-running KataGo worker.

- `HostedKataGoHttpProvider` calls an HTTPS origin supplied at runtime.
- `LocalKataGoHttpProvider` calls the same HTTP contract on loopback, suitable
  for a separately deployed local service.
- `DeterministicKataGoScoringProvider` performs no network I/O and is the only
  adapter routine CI tests should select.

The durable job adapters use the existing `analysis` dispatch endpoint; they do
not require a new public KataGo route. The optional direct HTTP adapters use
`POST /v1/scoring-proposal`. Provider URLs must be origins without credentials,
query strings, or fragments. Authentication is sent only through the server-side
token variable. Errors and diagnostics never include configured URLs or tokens.

## Request identity and stale-result safety

Every request is validated, copied, frozen, deterministically serialized, and
identified by a SHA-256 digest. Its identity includes:

- contract, analysis purpose (`initial-suggestion` or `deadline-adjudication`),
  and confidence-policy versions;
- game ID, stopped board hash and move number, and scoring revision;
- board size, exact stopped board, and dense complete canonical move history;
- ruleset, rules profile, rules version, scoring method, komi, and handicap;
- player to move after the stop;
- KataGo engine, model, and configuration versions; and
- the bounded visit count.

The response repeats the identity and position/rules/model bindings. Any mismatch
is a stable `stale_response` or `model_mismatch` error. Callers must additionally
compare the returned scoring revision and stopped board against the current
server-authoritative scoring row before persisting the suggestion.

## Confidence policy

Policy `gostone-dead-groups-v1` is deliberately conservative. The provider must
return signed ownership for every intersection and exactly one status/confidence
assessment for every occupied point. GoStone reconstructs connected groups from
the stopped board; it never trusts a provider-supplied partial group.

A group is suggested dead only when every stone is consistently `dead`, every
status confidence is at least `0.85`, and every point has at least `0.80`
opponent ownership. Seki, unknown/alive, inconsistent, low-confidence, and weak
ownership groups default alive. Ownership alone never removes a stone. After
removing only those complete suggested-dead groups, GoStone emits one canonical
neutral seed for an otherwise-owned empty region when it touches a seki group or
the ownership evidence is weak. This prevents ambiguous eyes from silently
becoming territory; final validation remains in the Japanese scoring service.

## Efficiency and failure policy

`KataGoScoringClient` coalesces concurrent requests with the same canonical
identity and caches only strictly validated proposals in a bounded LRU-like
in-memory cache. Durable job adapters additionally enforce one database row per
request identity, so multiple application instances coalesce the same immutable
request. The lifecycle integration must call it once when a new immutable scoring
boundary is created. Polling, reconnects, player confirmation, and manual
dead/alive edits must read the stored suggestion and must not call KataGo again.

The client defaults to a five-second attempt deadline; durable job adapters use a
bounded 25-second deadline to allow cold-start dispatch. It uses one retry, a
three-failure circuit threshold, a 30-second cooldown, and a 256-entry/ten-minute
cache. All bounds have defensive limits. Caller cancellation is isolated: it does
not abort an operation shared with another caller. Provider timeouts, malformed
or stale responses, and open circuits are explicit errors; the game lifecycle
must allow manual scoring while unavailable and must never invent an adjudicated
result.

## Environment variables

Only variable names and harmless defaults belong in `.env.example`:

- `KATAGO_SCORING_PROVIDER` (`modal-job`, `local-job`, `deterministic`,
  `hosted-http`, or `local-http`)
- `KATAGO_HOSTED_URL`
- `KATAGO_HOSTED_TOKEN`
- `KATAGO_LOCAL_URL`
- `KATAGO_ENGINE_VERSION`
- `KATAGO_MODEL_VERSION`
- `KATAGO_CONFIG_VERSION`
- `KATAGO_MAX_VISITS`

They are server-only; none may use a `NEXT_PUBLIC_` prefix. The example does not
select a provider by default: CI must opt into `deterministic`, and a deployed
application must fail closed rather than silently selecting the test double.

For a disposable, non-production database with an existing pending Japanese
scoring boundary, set `KATAGO_SCORING_SMOKE_GAME_ID`,
`KATAGO_SCORING_SMOKE_PLAYER_KEY`, and
`KATAGO_SCORING_SMOKE_NONPRODUCTION=true`, then run
`npm run test:katago-scoring-live`. The smoke test exercises the configured real
adapter, prints only non-sensitive provider/model evidence, and is intentionally
excluded from routine CI.
