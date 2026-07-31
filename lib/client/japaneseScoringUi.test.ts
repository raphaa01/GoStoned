import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { GamePanel } from "@/components/game/GamePanel";
import { createEmptyBoard } from "@/lib/game/goEngine";
import type { GameState } from "@/lib/game/types";
import { en } from "@/lib/i18n/catalogs/en";

const TestI18nProvider = I18nProvider as ComponentType<{
  children?: ReactNode;
  dictionary: typeof en;
  locale: "en";
}>;

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function japaneseScoringGame(): GameState {
  const board = createEmptyBoard(9);
  board[2][2] = "black";
  board[2][3] = "black";
  board[6][6] = "white";
  return {
    id: "01890f3e-7b7a-7cc2-98e7-5d5e08e7a65f",
    boardSize: 9,
    blackPlayerKey: "guest:black",
    whitePlayerKey: "guest:white",
    blackPlayerName: "Black player",
    whitePlayerName: "White player",
    winnerKey: null,
    rated: false,
    status: "active",
    phase: "scoring",
    result: null,
    finishReason: null,
    komi: 6.5,
    ruleset: "japanese",
    rulesProfile: "japanese-1989-gostone-v1",
    scoringMethod: "territory",
    handicap: 0,
    consecutivePasses: 2,
    scoringRevision: 3,
    scoring: {
      revision: 3,
      boardHash: "hash",
      stoppedMoveNumber: 12,
      deadStones: [{ x: 6, y: 6 }],
      blackConfirmed: false,
      whiteConfirmed: true,
      preview: {
        black: 4,
        white: 9.5,
        blackStones: 2,
        whiteStones: 0,
        blackTerritory: 3,
        whiteTerritory: 2,
        neutralPoints: 75,
        territoryExcludedByAgreement: 0,
        blackPrisoners: 1,
        whitePrisoners: 1,
        winner: "white",
        margin: 5.5,
        result: "W+5.5",
      },
      finalizedAt: null,
      expiresAt: "2026-08-01T10:05:00.000Z",
      resumptionsUsed: 1,
      resumptionsRemaining: 2,
      finalResolution: false,
      canUndo: true,
      canResetToSuggestion: true,
      suggestion: {
        status: "ready",
        transparentRole: "suggestion",
        providerKind: "deterministic",
        engineVersion: "test-engine",
        modelVersion: "test-model",
        configVersion: "test-config",
        confidencePolicyVersion: "test-confidence",
      },
    },
    lastResume: null,
    version: 8,
    startedAt: "2026-08-01T09:30:00.000Z",
    finishedAt: null,
    timeControl: "rapid",
    clock: {
      serverNow: "2026-08-01T10:00:00.000Z",
      mainTimeSeconds: 600,
      byoYomiPeriods: 5,
      byoYomiSeconds: 30,
      black: { mainTimeMs: 300_000, periodsRemaining: 5, displayTimeMs: 300_000, phase: "main" },
      white: { mainTimeMs: 300_000, periodsRemaining: 5, displayTimeMs: 300_000, phase: "main" },
    },
    turn: null,
    moveCount: 12,
    board,
    moves: [],
  };
}

function panel(game: GameState): string {
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(
    TestI18nProvider,
    { dictionary: en, locale: "en" },
    createElement(GamePanel, {
      game,
      playerKey: game.blackPlayerKey,
      busy: false,
      clockObservedAt: 1_000,
      interactionDisabled: false,
      onPass: noop,
      onResign: noop,
      onConfirmScore: noop,
      onResetScoring: noop,
      onResolveDeadline: noop,
      onResumeJapanesePlay: noop,
      onResumePlay: noop,
      onUndoScoring: noop,
      onLeave: noop,
    }),
  ));
}

test("renders the beginner Japanese territory workflow and its revision controls", () => {
  const html = panel(japaneseScoringGame());
  assert.match(html, /Finish the position in three steps/);
  assert.match(html, /Computer suggestion/);
  assert.match(html, /Provisional Japanese territory score/);
  assert.match(html, /Proposal revision <strong>3<\/strong>/);
  assert.match(html, /Undo last change/);
  assert.match(html, /Reset to suggestion/);
  assert.match(html, /Resume play/);
  assert.match(html, /Black: 3 territory \+ 1 prisoners/);
  assert.doesNotMatch(html, /Provisional Chinese area score/);
});

test("keeps the established Chinese dispute controls and area-score copy", () => {
  const japanese = japaneseScoringGame();
  const chinese: GameState = {
    ...japanese,
    komi: 7.5,
    ruleset: "chinese",
    rulesProfile: "chinese-2002-gostone-v1",
    scoringMethod: "area",
    scoring: japanese.scoring && {
      ...japanese.scoring,
      suggestion: undefined,
      preview: {
        black: 2,
        white: 8.5,
        blackStones: 2,
        whiteStones: 0,
        blackTerritory: 0,
        whiteTerritory: 1,
        neutralPoints: 78,
        winner: "white",
        margin: 6.5,
        result: "W+6.5",
      },
    },
  };
  const html = panel(chinese);
  assert.match(html, /Provisional Chinese area score/);
  assert.match(html, /Resume play to prove the group dead/);
  assert.match(html, /Resume play to challenge a dead mark/);
  assert.doesNotMatch(html, /Reset to suggestion/);
  assert.doesNotMatch(html, /Finish the position in three steps/);
});

test("fails closed while the initial Japanese suggestion is pending", () => {
  const ready = japaneseScoringGame();
  const pending = {
    ...ready,
    scoring: ready.scoring && {
      ...ready.scoring,
      canUndo: true,
      canResetToSuggestion: true,
      suggestion: ready.scoring.suggestion && {
        ...ready.scoring.suggestion,
        status: "pending" as const,
      },
    },
  };
  const html = panel(pending);
  assert.match(html, /Preparing a suggestion/);
  assert.ok((html.match(/<button disabled=""/g) ?? []).length >= 4);
  assert.match(source("components/game/GameRoom.tsx"), /suggestion\?\.status === "pending"/);
});

test("deadline expiry is an explicit mutation and never part of the poll loop", () => {
  const room = source("components/game/GameRoom.tsx");
  const poll = room.slice(room.indexOf("const pollGame = async"), room.indexOf("const pollChat = async"));
  assert.match(room, /scoringAction\("resolve-deadline", \{\}\)/);
  assert.match(room, /\/api\/games\/\$\{game\.id\}\/scoring\/\$\{action\}/);
  assert.doesNotMatch(poll, /resolve-deadline|KataGo|katago/);
  assert.doesNotMatch(source("components/game/ScoringDecisionCountdown.tsx"), /KataGo|katago|fetch\(/);
});

test("board and CSS retain group semantics and responsive 9/13/19 scoring layouts", () => {
  const board = source("components/game/GoBoard.tsx");
  const css = source("app/globals.css");
  assert.match(board, /copy\.markGroupLabel/);
  assert.match(board, /copy\.restoreGroupLabel/);
  assert.match(board, /aria-selected=\{interactionMode === "mark-dead"/);
  assert.match(css, /\.go-board\[data-size="13"\]/);
  assert.match(css, /\.go-board\[data-size="19"\]\[data-interaction-mode="mark-dead"\]/);
  assert.match(css, /\.focused-game-layout\s*\{[\s\S]*grid-template-columns: 1fr;/);
});
