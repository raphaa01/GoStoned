# Stone visibility and the October 2026 report

The reported Japanese 9×9 blitz matchmaking game started on 9 October 2026
at 15:15 Europe/Berlin and ended after 48 moves. A read-only inspection found
that all 48 stored board hashes match both ordinary replay and the Japanese
normal-play rulebook. Black's D9 stone is legally captured by White's C9 at
move 38; White plays a new stone on D9 at move 40. The final two passes leave
the board unchanged. Seven white dead stones were removed only from the
finished scoring display after agreement. The move log and review retain them.
No stored-position corruption was found in this report.

`lib/game/fixtures/captureIncident9x9.ts` retains the anonymized move sequence
and hashes as a regression fixture, without player identities or credentials.

The shared website, iOS and Android game room now binds optimistic moves to
their game ID and base version. A newer authoritative position suppresses both
the optimistic replay and the pending-stone overlay, even if the original POST
response is delayed. This prevents an old preview from replaying captures or
resurrecting a stone already captured by an opponent.

Full game responses must match their move histories before replacing the
accepted board. The usual append path checks only the additional moves; initial
loads and takebacks reconstruct the position. Invalid snapshots leave the last
accepted state in place and ordinary polling can recover with a valid response.
Clock-only heartbeats skip this check. Immediate local move placement still runs
before the POST response, without a new timer, request or server wait.

Review recommendation rings are unfilled and labeled as the best move. They
never count as stones or change the replayed board. The shared browser tests
cover the delayed-response capture race, corrupt snapshot recovery, the reported
capture and the recommendation overlay in website and bundled mobile clients.
