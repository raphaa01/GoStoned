import type { Dictionary } from "@/lib/i18n/dictionary";
import { formatBoardLabel, goCoordinate, joinBoardLabels } from "./boardAccessibility";
import { groupMarkedDeadStones } from "./scoring";
import type { GameState, Stone } from "./types";

function colorName(color: Stone, copy: Dictionary["game"]): string {
  return color === "black" ? copy.black : copy.white;
}

function groupName(color: Stone, copy: Dictionary["game"]): string {
  return color === "black" ? copy.blackGroupAnnouncement : copy.whiteGroupAnnouncement;
}

export function localizedGameResult(
  result: string | null,
  copy: Dictionary["game"],
): string {
  if (!result) return copy.ended;
  if (result === "Void") return copy.noResult;
  const [winner, detail] = result.split("+");
  if (winner !== "B" && winner !== "W") return result;
  const color = winner === "B" ? copy.black : copy.white;
  if (detail === "R") return `${color} ${copy.winsResignation}`;
  if (detail === "T") return `${color} ${copy.winsTime}`;
  if (detail === "F") return `${color} ${copy.winsAbandonment}`;
  return `${color} ${copy.winsPoints} ${detail} ${copy.points}`;
}

function capturedStoneCount(previous: GameState, next: GameState): number {
  let captured = 0;
  for (let y = 0; y < previous.boardSize; y += 1) {
    for (let x = 0; x < previous.boardSize; x += 1) {
      if (previous.board[y]?.[x] && !next.board[y]?.[x]) captured += 1;
    }
  }
  return captured;
}

function nextTurnAnnouncement(game: GameState, copy: Dictionary["game"]): string {
  if (!game.turn) return "";
  return formatBoardLabel(copy.toPlayAnnouncement, {
    color: colorName(game.turn, copy),
  });
}

export function describeGameChange(
  previous: GameState | null,
  next: GameState,
  copy: Dictionary["game"],
): string | null {
  if (!previous || previous.id !== next.id) return null;

  if (previous.status !== "finished" && next.status === "finished") {
    return `${copy.gameOver}. ${localizedGameResult(next.result, copy)}`;
  }

  if (previous.phase !== next.phase) {
    if (next.phase === "scoring") {
      if (next.rulesProfile === "japanese-1989-gostone-v1") {
        return next.scoring?.finalResolution
          ? copy.finalScoringStartedAnnouncement
          : copy.japaneseScoringStartedAnnouncement;
      }
      return copy.scoringStartedAnnouncement;
    }
    const resumed = next.lastResume?.claim === "deadline"
      ? copy.scoringExpired
      : copy.disputeResumed;
    return `${resumed} ${nextTurnAnnouncement(next, copy)}`.trim();
  }

  if (next.moveCount > previous.moveCount) {
    const move = next.moves.at(-1);
    if (!move) return nextTurnAnnouncement(next, copy) || null;
    const action = move.isPass || move.x === null || move.y === null
      ? formatBoardLabel(copy.passAnnouncement, {
          color: colorName(move.color, copy),
        })
      : formatBoardLabel(copy.moveAnnouncement, {
          color: colorName(move.color, copy),
          coordinate: goCoordinate(next.boardSize, move.x, move.y),
        });
    const captured = capturedStoneCount(previous, next);
    const capture = captured > 0
      ? formatBoardLabel(
          captured === 1 ? copy.singleCaptureAnnouncement : copy.captureAnnouncement,
          { count: captured },
        )
      : "";
    return [action, capture, nextTurnAnnouncement(next, copy)].filter(Boolean).join(" ");
  }

  if (
    previous.phase === "scoring"
    && next.phase === "scoring"
    && previous.scoring
    && next.scoring
    && previous.scoring.revision !== next.scoring.revision
  ) {
    const previousDead = new Set(previous.scoring.deadStones.map(({ x, y }) => `${x}:${y}`));
    const nextDead = new Set(next.scoring.deadStones.map(({ x, y }) => `${x}:${y}`));
    const added = next.scoring.deadStones.filter(({ x, y }) => !previousDead.has(`${x}:${y}`));
    const removed = previous.scoring.deadStones.filter(({ x, y }) => !nextDead.has(`${x}:${y}`));
    const announcements = [
      ...groupMarkedDeadStones(next.board, added).map((group) =>
        formatBoardLabel(copy.groupMarkedDeadAnnouncement, {
          group: groupName(group.color, copy),
          coordinate: goCoordinate(next.boardSize, group.representative.x, group.representative.y),
          stoneCount: `${group.stones.length} ${group.stones.length === 1 ? copy.stone : copy.stones}`,
        }),
      ),
      ...groupMarkedDeadStones(previous.board, removed).map((group) =>
        formatBoardLabel(copy.groupRestoredAnnouncement, {
          group: groupName(group.color, copy),
          coordinate: goCoordinate(next.boardSize, group.representative.x, group.representative.y),
          stoneCount: `${group.stones.length} ${group.stones.length === 1 ? copy.stone : copy.stones}`,
        }),
      ),
    ];
    const confirmationsCleared =
      (previous.scoring.blackConfirmed && !next.scoring.blackConfirmed)
      || (previous.scoring.whiteConfirmed && !next.scoring.whiteConfirmed);
    const skippedRevisions = next.scoring.revision > previous.scoring.revision + 1;
    const japaneseRevision = next.rulesProfile === "japanese-1989-gostone-v1"
      ? formatBoardLabel(copy.scoringRevisionAnnouncement, {
          revision: next.scoring.revision,
        })
      : "";
    if (announcements.length > 0 || skippedRevisions || confirmationsCleared) {
      return joinBoardLabels(
        skippedRevisions && copy.multipleScoringChangesAnnouncement,
        japaneseRevision,
        ...announcements,
        confirmationsCleared && copy.confirmationsClearedAnnouncement,
      );
    }
    if (japaneseRevision) return japaneseRevision;
  }

  if (
    previous.scoring?.suggestion?.status !== next.scoring?.suggestion?.status
    && next.rulesProfile === "japanese-1989-gostone-v1"
  ) {
    return next.scoring?.suggestion?.status === "ready"
      ? copy.suggestionReadyAnnouncement
      : next.scoring?.suggestion?.status === "not-requested"
        ? null
        : copy.suggestionUnavailableAnnouncement;
  }

  if (previous.scoring && next.scoring) {
    if (!previous.scoring.blackConfirmed && next.scoring.blackConfirmed) {
      return formatBoardLabel(copy.scoreConfirmedAnnouncement, { color: copy.black });
    }
    if (!previous.scoring.whiteConfirmed && next.scoring.whiteConfirmed) {
      return formatBoardLabel(copy.scoreConfirmedAnnouncement, { color: copy.white });
    }
  }

  for (const color of ["black", "white"] as const) {
    if (previous.clock[color].phase === "main" && next.clock[color].phase === "byo-yomi") {
      const periods = next.clock[color].periodsRemaining;
      return formatBoardLabel(copy.byoYomiAnnouncement, {
        color: colorName(color, copy),
        periodCount: `${periods} ${periods === 1 ? copy.period : copy.periods}`,
      });
    }
  }

  return null;
}
