# GoStone Japanese rules profile

Profile: `japanese-1989-gostone-v1`

GoStone implements the 1989 Japanese Rules of Go as published jointly by the
Nihon Ki-in and Kansai Ki-in. The authoritative full text is dated 10 April
1989 and took effect on 15 May 1989:

- https://www.nihonkiin.or.jp/match/kiyaku/zenbun.htm
- https://www.nihonkiin.or.jp/match/kiyaku/index.html

The rules text is authoritative for play, capture, ko, life and death,
territory, stopping, resumption, scoring, resignation, and no-result. GoStone's
online match conditions (board size, komi, clocks, decision deadline, bounded
resumptions, and KataGo assistance) are versioned product policy and are not
presented as part of the 1989 text.

## Rules-to-code map

| Material rule | GoStone authority | Regression evidence |
| --- | --- | --- |
| Articles 2–5: alternating play, legal empty intersections, suicide prohibition, and capture | `goEngine.ts`, `japaneseKo.ts` | `goEngine.test.ts`, `japaneseKo.test.ts` |
| Article 6: the just-captured ko cannot immediately be retaken | `japaneseKo.ts` | `japaneseKo.test.ts` center, corner, snapback, pass, and malformed-history cases |
| Articles 7–8: life/death agreement; dame and seki do not become territory | `japaneseScoring.ts` plus validated proposal evidence | `japaneseScoring.test.ts` complete groups, neutral regions, seki, dame, and unsettled positions |
| Article 9.1: consecutive passes stop play rather than finalize | `japanesePhaseAuthority.ts` | `japanesePhaseAuthority.test.ts` pass-pass cases |
| Article 9.2: both players agree on life/death and territory | proposal digest plus revision-bound confirmations | `japaneseSettlementProposal.test.ts`, Japanese service and database race tests |
| Article 9.3: either player may resume; the opponent moves first | `japanesePhaseAuthority.ts` and append-only resume evidence | `japanesePhaseAuthority.test.ts`, Japanese resume persistence smoke |
| Article 10: dead stones become prisoners and territory decides the result | `scoreJapaneseTerritory` | `japaneseScoring.test.ts` prisoner, komi, jigo, and result cases |
| Article 11: resignation | terminal game service | game route/service and browser tests |
| Article 12: cyclic repetition may become no-result | Japanese replay and terminal no-result authority | Japanese ko/service tests |

The Nihon Ki-in's Article 3 commentary explicitly permits smaller boards by
agreement for beginners. GoStone supports 9x9, 13x13, and 19x19 under the same
profile: https://www.nihonkiin.or.jp/match/kiyaku/kiyaku03.htm

The Nihon Ki-in's Article 8 commentary is the basis for treating dame and eyes
of seki groups conservatively rather than counting them as territory:
https://www.nihonkiin.or.jp/match/kiyaku/kiyaku08.htm

## GoStone match policy v1

- Even games use 6.5 komi.
- Verified handicap creation is release-gated until placement, White-first
  authority, `HA`/`AB` SGF, database, and browser acceptance tests all pass.
  The UI must not offer an unverified handicap game.
- Two consecutive passes create an immutable stopped-position boundary.
- KataGo may propose complete dead groups and neutral-region evidence once per
  stopped position. It is labeled as a suggestion and never scores the game.
- Player edits create a new server revision and clear both confirmations.
- Both players must confirm the same proposal digest.
- Either player may request resumption. The requester's opponent moves first.
- A game may resume from scoring at most three times. The next scoring phase is
  the final resolution phase.
- The live scoring-decision window defaults to five minutes and is configurable
  by server policy. The normal play clock is paused while scoring is active.
- Participation is explicit. Silence is never agreement. One responsive player
  versus one non-responsive player is an abandonment; no participation by
  either player is no-contest/no-result.
- After the final decision deadline, a fresh, position-bound, validated KataGo
  result may adjudicate. An unavailable, stale, malformed, or low-confidence
  result produces no-result and no rating change, with diagnostic evidence.

## Compatibility and rollback

The profile is selected only from each game's persisted rules tuple. Historical
`legacy-immediate-area` and `chinese-2002-gostone-v1` games remain on their
original Chinese scoring paths and are never reinterpreted.

The initial rollout is additive. Roll back application creation to the current
Chinese profile and leave Japanese tables/evidence in place. Do not drop
Chinese code, tables, constraints, or migrations as part of this rollout.
